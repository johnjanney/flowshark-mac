//! macOS system integration.
//!
//! Three things the web layer cannot do on its own, and that the brief asks
//! for in §8.11 and §8.17:
//!
//! 1. Writing a diagram to the pasteboard under every type other applications
//!    look for — `public.png`, `com.adobe.pdf`, `public.svg-image`, and
//!    `public.utf8-plain-text` — as a single pasteboard item, so Keynote takes
//!    the PDF, a browser takes the SVG, and Mail takes the PNG.
//! 2. Presenting the system share sheet.
//! 3. Starting a drag session that hands a real file to the Finder, Mail, or
//!    Keynote.
//!
//! Every AppKit call happens on the main thread. Commands may arrive on a
//! worker thread, so `on_main_thread` either runs the work directly when it is
//! already there or hands it to the event loop — never blocking the main
//! thread on itself.

use std::sync::mpsc;
use std::sync::Mutex;

use objc2::rc::Retained;
use objc2::runtime::{AnyObject, ProtocolObject};
use objc2::{define_class, AnyThread, MainThreadMarker, MainThreadOnly};
use objc2_app_kit::{
    NSApplication, NSDragOperation, NSDraggingContext, NSDraggingItem, NSDraggingSession,
    NSDraggingSource, NSEvent, NSEventType, NSPasteboard, NSPasteboardItem, NSPasteboardType,
    NSPasteboardTypePDF, NSPasteboardTypePNG, NSPasteboardTypeString, NSPasteboardWriting,
    NSSharingServicePicker, NSView, NSWindow, NSWorkspace,
};
use objc2_foundation::{
    NSArray, NSData, NSObjectProtocol, NSPoint, NSRect, NSRectEdge, NSSize, NSString, NSURL,
};
use serde::Deserialize;
use tauri::{AppHandle, Manager, WebviewWindow};

use crate::grants::{Access, Grants};

/// The Uniform Type Identifier for SVG. AppKit has no constant for it.
const SVG_UTI: &str = "public.svg-image";

// ---------------------------------------------------------------------------
// Main-thread dispatch
// ---------------------------------------------------------------------------

/// Run `work` on the main thread and wait for its result.
fn on_main_thread<T, F>(app: &AppHandle, work: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce(MainThreadMarker) -> Result<T, String> + Send + 'static,
{
    // Already on the main thread: run it directly. Posting to the event loop
    // and then waiting for it here would deadlock.
    if let Some(marker) = MainThreadMarker::new() {
        return work(marker);
    }

    let (sender, receiver) = mpsc::channel();
    app.run_on_main_thread(move || {
        // SAFETY: `run_on_main_thread` runs this closure on the main thread.
        let marker = unsafe { MainThreadMarker::new_unchecked() };
        let _ = sender.send(work(marker));
    })
    .map_err(|error| error.to_string())?;

    receiver
        .recv()
        .map_err(|_| "The main thread did not complete the request.".to_string())?
}

/// The `NSView` a window draws into, which anchors popovers and drag sessions.
fn content_view(window: &WebviewWindow) -> Result<Retained<NSView>, String> {
    let pointer = window.ns_window().map_err(|error| error.to_string())?;
    if pointer.is_null() {
        return Err("This window has no macOS window behind it.".to_string());
    }
    // SAFETY: `ns_window` returns the window's `NSWindow`, and this only runs
    // on the main thread.
    let ns_window: &NSWindow = unsafe { &*(pointer as *const NSWindow) };
    ns_window
        .contentView()
        .ok_or_else(|| "This window has no content view.".to_string())
}

/// Convert a point given in web coordinates, which grow downwards, into the
/// view's own coordinates, which grow upwards.
fn flip_into_view(view: &NSView, x: f64, y: f64) -> NSPoint {
    let height = view.frame().size.height;
    NSPoint::new(x, height - y)
}

// ---------------------------------------------------------------------------
// Pasteboard
// ---------------------------------------------------------------------------

/// Representations of one diagram. Every field is optional; whatever is
/// supplied is written as an alternative representation of the same item.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PasteboardPayload {
    pub png: Option<Vec<u8>>,
    pub pdf: Option<Vec<u8>>,
    pub svg: Option<String>,
    pub text: Option<String>,
}

fn write_pasteboard(payload: &PasteboardPayload) -> Result<(), String> {
    let item = NSPasteboardItem::new();
    let mut wrote_anything = false;

    // Richest first: an application that understands several of these picks
    // the one it lists earliest, and PDF keeps the diagram as vector art.
    if let Some(bytes) = &payload.pdf {
        let data = NSData::with_bytes(bytes);
        item.setData_forType(&data, unsafe { NSPasteboardTypePDF });
        wrote_anything = true;
    }
    if let Some(bytes) = &payload.png {
        let data = NSData::with_bytes(bytes);
        item.setData_forType(&data, unsafe { NSPasteboardTypePNG });
        wrote_anything = true;
    }
    if let Some(svg) = &payload.svg {
        let svg_type = NSString::from_str(SVG_UTI);
        let data = NSData::with_bytes(svg.as_bytes());
        let svg_type: &NSPasteboardType = &svg_type;
        item.setData_forType(&data, svg_type);
        wrote_anything = true;
    }
    if let Some(text) = &payload.text {
        let value = NSString::from_str(text);
        item.setString_forType(&value, unsafe { NSPasteboardTypeString });
        wrote_anything = true;
    }

    if !wrote_anything {
        return Err("Nothing was supplied to copy.".to_string());
    }

    let pasteboard = NSPasteboard::generalPasteboard();
    pasteboard.clearContents();
    let writer: &ProtocolObject<dyn NSPasteboardWriting> = ProtocolObject::from_ref(&*item);
    let objects = NSArray::from_slice(&[writer]);
    if pasteboard.writeObjects(&objects) {
        Ok(())
    } else {
        Err("macOS refused the pasteboard write.".to_string())
    }
}

/// Put a diagram on the pasteboard under every type it was given.
#[tauri::command]
pub fn copy_diagram_to_pasteboard(
    app: AppHandle,
    payload: PasteboardPayload,
) -> Result<(), String> {
    on_main_thread(&app, move |_marker| write_pasteboard(&payload))
}

// ---------------------------------------------------------------------------
// Share sheet
// ---------------------------------------------------------------------------

/// The picker has to stay alive while it is on screen; AppKit does not retain
/// it for us.
#[derive(Default)]
pub struct SharePicker(pub Mutex<Option<Retained<NSSharingServicePicker>>>);

// SAFETY: the picker is only ever created, stored, and dropped on the main
// thread, inside `on_main_thread`.
unsafe impl Send for SharePicker {}
unsafe impl Sync for SharePicker {}

fn file_urls(paths: &[String]) -> Retained<NSArray<AnyObject>> {
    let urls: Vec<Retained<NSURL>> = paths
        .iter()
        .map(|path| NSURL::fileURLWithPath(&NSString::from_str(path)))
        .collect();
    let objects: Vec<&AnyObject> = urls.iter().map(|url| url.as_ref() as &AnyObject).collect();
    NSArray::from_slice(&objects)
}

/// Turn grant tokens into the paths they stand for.
///
/// Sharing and dragging hand a real file to another application, so they are
/// exactly the operations that must not accept a pathname the web layer chose.
fn resolve_all(app: &AppHandle, tokens: &[String], what: &str) -> Result<Vec<String>, String> {
    if tokens.is_empty() {
        return Err(format!("There is nothing to {what}."));
    }
    let grants = app.state::<Grants>();
    tokens
        .iter()
        .map(|token| {
            grants
                .resolve(token, Access::Read)
                .map(|path| path.to_string_lossy().to_string())
        })
        .collect()
}

/// Show the system share sheet for `paths`, anchored near (`x`, `y`).
#[tauri::command]
pub fn share_files(
    app: AppHandle,
    window: WebviewWindow,
    tokens: Vec<String>,
    x: f64,
    y: f64,
) -> Result<(), String> {
    let paths = resolve_all(&app, &tokens, "share")?;
    on_main_thread(&app, move |marker| {
        let view = content_view(&window)?;
        let items = file_urls(&paths);
        let picker = unsafe {
            NSSharingServicePicker::initWithItems(NSSharingServicePicker::alloc(), &items)
        };

        let origin = flip_into_view(&view, x, y);
        let rect = NSRect::new(origin, NSSize::new(1.0, 1.0));
        picker.showRelativeToRect_ofView_preferredEdge(rect, &view, NSRectEdge::MinY);

        // Hold on to it until the next share replaces it.
        if let Some(state) = window.app_handle().try_state::<SharePicker>() {
            if let Ok(mut held) = state.0.lock() {
                *held = Some(picker);
            }
        }
        let _ = marker;
        Ok(())
    })
}

// ---------------------------------------------------------------------------
// Dragging a file out to the Finder
// ---------------------------------------------------------------------------

define_class!(
    // SAFETY:
    // - NSObject has no subclassing requirements.
    // - The class does not implement Drop.
    #[unsafe(super(objc2_foundation::NSObject))]
    #[name = "FlowSharkDragSource"]
    #[thread_kind = MainThreadOnly]
    pub struct DragSource;

    unsafe impl NSObjectProtocol for DragSource {}

    unsafe impl NSDraggingSource for DragSource {
        #[unsafe(method(draggingSession:sourceOperationMaskForDraggingContext:))]
        fn source_operation_mask(
            &self,
            _session: &NSDraggingSession,
            _context: NSDraggingContext,
        ) -> NSDragOperation {
            // Dragging a diagram out copies it; the original file stays put.
            NSDragOperation::Copy
        }
    }
);

/// Keeps the drag source alive for the length of the session.
#[derive(Default)]
pub struct DragState(pub Mutex<Option<Retained<DragSource>>>);

// SAFETY: only touched on the main thread, inside `on_main_thread`.
unsafe impl Send for DragState {}
unsafe impl Sync for DragState {}

/// The event a drag session is started from.
///
/// AppKit will only begin a drag in response to a mouse event. The event the
/// application is currently handling is the right one to use; if there is not
/// one — which happens when the request arrives a moment after the pointer
/// event that caused it — a matching event is synthesised at the same place.
fn drag_event(
    marker: MainThreadMarker,
    view: &NSView,
    location: NSPoint,
) -> Result<Retained<NSEvent>, String> {
    let application = NSApplication::sharedApplication(marker);
    if let Some(event) = application.currentEvent() {
        let kind = event.r#type();
        if matches!(
            kind,
            NSEventType::LeftMouseDown | NSEventType::LeftMouseDragged
        ) {
            return Ok(event);
        }
    }

    let window_number = view
        .window()
        .map(|window| window.windowNumber())
        .unwrap_or(0);
    {
        NSEvent::mouseEventWithType_location_modifierFlags_timestamp_windowNumber_context_eventNumber_clickCount_pressure(
            NSEventType::LeftMouseDragged,
            location,
            objc2_app_kit::NSEventModifierFlags::empty(),
            0.0,
            window_number,
            None,
            0,
            1,
            1.0,
        )
    }
    .ok_or_else(|| "macOS would not create a drag event.".to_string())
}

/// Start dragging `paths` out of the window from (`x`, `y`).
#[tauri::command]
pub fn begin_file_drag(
    app: AppHandle,
    window: WebviewWindow,
    tokens: Vec<String>,
    x: f64,
    y: f64,
) -> Result<(), String> {
    let paths = resolve_all(&app, &tokens, "drag")?;
    on_main_thread(&app, move |marker| {
        let view = content_view(&window)?;
        let origin = flip_into_view(&view, x, y);
        let event = drag_event(marker, &view, origin)?;
        let workspace = NSWorkspace::sharedWorkspace();

        let mut items: Vec<Retained<NSDraggingItem>> = Vec::with_capacity(paths.len());
        for (index, path) in paths.iter().enumerate() {
            let text = NSString::from_str(path);
            let url = NSURL::fileURLWithPath(&text);
            let writer: &ProtocolObject<dyn NSPasteboardWriting> = ProtocolObject::from_ref(&*url);
            let item = NSDraggingItem::initWithPasteboardWriter(NSDraggingItem::alloc(), writer);

            // Drag the file's own Finder icon, offset so a multiple selection
            // fans out slightly.
            let icon = workspace.iconForFile(&text);
            let size = NSSize::new(64.0, 64.0);
            let offset = index as f64 * 8.0;
            let frame = NSRect::new(
                NSPoint::new(origin.x - 32.0 + offset, origin.y - 32.0 - offset),
                size,
            );
            unsafe { item.setDraggingFrame_contents(frame, Some(&icon)) };
            items.push(item);
        }

        let source = DragSource::alloc(marker);
        let source: Retained<DragSource> = unsafe { objc2::msg_send![source, init] };
        let protocol: &ProtocolObject<dyn NSDraggingSource> = ProtocolObject::from_ref(&*source);

        let refs: Vec<&NSDraggingItem> = items.iter().map(|item| item.as_ref()).collect();
        let array = NSArray::from_slice(&refs);
        let _session = view.beginDraggingSessionWithItems_event_source(&array, &event, protocol);

        if let Some(state) = window.app_handle().try_state::<DragState>() {
            if let Ok(mut held) = state.0.lock() {
                *held = Some(source);
            }
        }
        Ok(())
    })
}
