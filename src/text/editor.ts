/**
 * Inline text editing.
 *
 * Editing happens in a real `<textarea>` positioned over the shape rather than
 * in a custom text engine. That is what gives FlowShark the whole macOS text
 * stack for free: input methods for Chinese, Japanese, and Korean; dead keys
 * and press-and-hold accents; the Emoji and Symbols picker; system spelling and
 * grammar checking; text substitutions; and the standard editing key bindings.
 */

import type { Rect } from '../model/geometry';
import { isConnector, isShape } from '../model/types';
import type { ElementId, TextStyle } from '../model/types';
import { fontStack } from '../model/defaults';
import { getShapeDefinition, textBoxFor } from '../shapes/library';
import { routeOf } from '../model/document';
import { pointAlongPolyline, tangentAlongPolyline } from '../model/geometry';
import { layoutText } from './layout';
import { setConnectorLabelText, setElementText } from '../commands/actions';
import type { Store } from '../state/store';
import type { CanvasRenderer } from '../canvas/renderer';

export interface TextEditorCallbacks {
  onCommit(): void;
}

export class InlineTextEditor {
  private field: HTMLTextAreaElement | null = null;
  private target: { elementId: ElementId; labelId: string | null } | null = null;

  constructor(
    private readonly store: Store,
    private readonly renderer: CanvasRenderer,
    private readonly layer: HTMLElement,
    private readonly callbacks: TextEditorCallbacks,
  ) {}

  get isEditing(): boolean {
    return this.field !== null;
  }

  get editingId(): ElementId | null {
    return this.target?.elementId ?? null;
  }

  begin(elementId: ElementId, labelId: string | null = null, selectAll = true): void {
    this.commit();
    const doc = this.store.document;
    const element = doc.elements[elementId];
    if (!element || element.locked) return;

    let value = '';
    let style: TextStyle;
    if (isShape(element)) {
      value = element.text.value;
      style = element.text.style;
    } else if (isConnector(element)) {
      const label = element.labels.find((entry) => entry.id === labelId) ?? element.labels[0];
      if (!label) return;
      labelId = label.id;
      value = label.text;
      style = label.style;
    } else {
      return;
    }

    const field = document.createElement('textarea');
    field.className = 'text-editor';
    field.value = value;
    field.spellcheck = true;
    field.setAttribute('aria-label', 'Element text');
    field.autocapitalize = 'sentences';
    field.wrap = 'soft';

    this.field = field;
    this.target = { elementId, labelId };
    this.layer.append(field);
    this.position(style);

    field.addEventListener('blur', this.onBlur);
    field.addEventListener('keydown', this.onKeyDown);
    field.addEventListener('input', this.onInput);

    field.focus({ preventScroll: true });
    if (selectAll) field.select();
    else field.setSelectionRange(field.value.length, field.value.length);

    this.store.setUi({ editing: { elementId, labelId } });
    const node = this.renderer.nodeFor(elementId);
    node?.setAttribute('data-editing', 'true');
  }

  /** Re-place the field after a pan, zoom, or resize. */
  reposition(): void {
    if (!this.field || !this.target) return;
    const element = this.store.document.elements[this.target.elementId];
    if (isShape(element)) this.position(element.text.style);
    else if (isConnector(element)) {
      const label = element.labels.find((entry) => entry.id === this.target?.labelId);
      if (label) this.position(label.style);
    }
  }

  private position(style: TextStyle): void {
    if (!this.field || !this.target) return;
    const doc = this.store.document;
    const element = doc.elements[this.target.elementId];
    const { zoom } = this.store.getState().view;

    let box: Rect;
    if (isShape(element)) {
      const definition = getShapeDefinition(element.shape);
      const region = textBoxFor(definition, element.frame);
      box = {
        x: region.x + element.text.padding,
        y: region.y + element.text.padding,
        width: Math.max(region.width - element.text.padding * 2, 24),
        height: Math.max(region.height - element.text.padding * 2, 18),
      };
    } else if (isConnector(element)) {
      const label = element.labels.find((entry) => entry.id === this.target?.labelId);
      if (!label) return;
      const route = routeOf(doc, element);
      const anchor = pointAlongPolyline(route.points, label.position);
      const tangent = tangentAlongPolyline(route.points, label.position);
      const normal = { x: -tangent.y, y: tangent.x };
      const centre = {
        x: anchor.x + normal.x * label.offset,
        y: anchor.y + normal.y * label.offset,
      };
      const layout = layoutText(label.text || 'Label', label.style, 400);
      const width = Math.max(layout.width + 20, 60);
      const height = layout.height + 8;
      box = { x: centre.x - width / 2, y: centre.y - height / 2, width, height };
    } else {
      return;
    }

    const topLeft = this.renderer.canvasToScreen(box);
    const field = this.field;
    field.style.left = `${topLeft.x}px`;
    field.style.top = `${topLeft.y}px`;
    field.style.width = `${box.width * zoom}px`;
    field.style.height = `${box.height * zoom}px`;
    field.style.fontFamily = fontStack(style.fontFamily);
    field.style.fontSize = `${style.fontSize * zoom}px`;
    field.style.fontWeight = String(style.fontWeight);
    field.style.fontStyle = style.italic ? 'italic' : 'normal';
    field.style.textDecoration = style.underline ? 'underline' : 'none';
    field.style.lineHeight = String(style.lineHeight);
    field.style.color = style.color;
    field.style.textAlign = style.align;
    field.style.padding = `${2 * zoom}px ${3 * zoom}px`;
  }

  private onInput = (): void => {
    // Grow the field as the user types past the bottom of the shape.
    if (!this.field) return;
    const wanted = this.field.scrollHeight;
    if (wanted > this.field.clientHeight) this.field.style.height = `${wanted}px`;
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    // While a text field has focus the canvas must not see the key.
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      this.commit();
      return;
    }
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      this.commit();
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      this.commit();
    }
  };

  private onBlur = (): void => {
    this.commit();
  };

  /** Write the edited text back into the document and tear the field down. */
  commit(): void {
    const field = this.field;
    const target = this.target;
    if (!field || !target) return;

    this.field = null;
    this.target = null;

    field.removeEventListener('blur', this.onBlur);
    field.removeEventListener('keydown', this.onKeyDown);
    field.removeEventListener('input', this.onInput);
    const value = field.value;
    field.remove();

    const element = this.store.document.elements[target.elementId];
    if (isShape(element) && element.text.value !== value) {
      setElementText(this.store, target.elementId, value);
    } else if (isConnector(element) && target.labelId) {
      const label = element.labels.find((entry) => entry.id === target.labelId);
      if (label && label.text !== value) {
        setConnectorLabelText(this.store, target.elementId, target.labelId, value);
      }
    }

    this.renderer.nodeFor(target.elementId)?.removeAttribute('data-editing');
    this.store.setUi({ editing: null });
    this.store.history.breakCoalescing();
    this.callbacks.onCommit();
  }

  cancel(): void {
    this.commit();
  }
}
