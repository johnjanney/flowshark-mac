/**
 * Starter templates.
 *
 * Every template is a complete, editable document — not a locked layout — so a
 * user can open one and immediately change anything in it.
 */

import type { FlowsharkDocument } from '../model/types';
import { createEmptyDocument } from '../model/defaults';
import { BOTTOM, LEFT, RIGHT, TOP, buildTemplateDocument } from './builder';

export interface TemplateDefinition {
  id: string;
  name: string;
  description: string;
  category: 'Flowcharts' | 'Business' | 'Technical';
  build(): FlowsharkDocument;
}

const GREEN = { fill: '#e4f5ea', stroke: '#1f7a4d' };
const AMBER = { fill: '#fdf1dc', stroke: '#a86a12' };
const ROSE = { fill: '#fbe6ea', stroke: '#a8283f' };
const SLATE = { fill: '#eceff4', stroke: '#54607a' };

const templates: TemplateDefinition[] = [
  {
    id: 'blank',
    name: 'Blank',
    description: 'An empty canvas.',
    category: 'Flowcharts',
    build: () => createEmptyDocument('Untitled'),
  },
  {
    id: 'basic-flowchart',
    name: 'Basic Flowchart',
    description: 'Start, a few steps, one decision, and an end.',
    category: 'Flowcharts',
    build: () =>
      buildTemplateDocument(
        'Basic Flowchart',
        [
          { id: 'start', shape: 'terminator', x: 320, y: 60, text: 'Start', style: GREEN },
          { id: 'step1', shape: 'process', x: 315, y: 160, text: 'First step' },
          { id: 'decide', shape: 'decision', x: 315, y: 270, text: 'Condition met?' },
          { id: 'yes', shape: 'process', x: 315, y: 410, text: 'Do the work' },
          { id: 'no', shape: 'process', x: 90, y: 400, text: 'Handle the exception', style: AMBER },
          { id: 'end', shape: 'terminator', x: 320, y: 520, text: 'End', style: ROSE },
        ],
        [
          { from: 'start', to: 'step1', fromAnchor: BOTTOM, toAnchor: TOP },
          { from: 'step1', to: 'decide', fromAnchor: BOTTOM, toAnchor: TOP },
          { from: 'decide', to: 'yes', fromAnchor: BOTTOM, toAnchor: TOP, label: 'Yes' },
          { from: 'decide', to: 'no', fromAnchor: LEFT, toAnchor: TOP, label: 'No' },
          { from: 'yes', to: 'end', fromAnchor: BOTTOM, toAnchor: TOP },
          { from: 'no', to: 'end', fromAnchor: BOTTOM, toAnchor: LEFT },
        ],
        'A starting point for any simple process.',
      ),
  },
  {
    id: 'decision-tree',
    name: 'Decision Tree',
    description: 'A branching structure with two levels of choices.',
    category: 'Flowcharts',
    build: () =>
      buildTemplateDocument(
        'Decision Tree',
        [
          { id: 'root', shape: 'decision', x: 400, y: 60, text: 'Primary question?' },
          { id: 'a', shape: 'decision', x: 170, y: 220, text: 'Follow-up A?' },
          { id: 'b', shape: 'decision', x: 630, y: 220, text: 'Follow-up B?' },
          { id: 'a1', shape: 'process', x: 60, y: 380, text: 'Outcome 1', style: GREEN },
          { id: 'a2', shape: 'process', x: 250, y: 380, text: 'Outcome 2', style: AMBER },
          { id: 'b1', shape: 'process', x: 520, y: 380, text: 'Outcome 3', style: AMBER },
          { id: 'b2', shape: 'process', x: 710, y: 380, text: 'Outcome 4', style: ROSE },
        ],
        [
          { from: 'root', to: 'a', fromAnchor: LEFT, toAnchor: TOP, label: 'Yes' },
          { from: 'root', to: 'b', fromAnchor: RIGHT, toAnchor: TOP, label: 'No' },
          { from: 'a', to: 'a1', fromAnchor: BOTTOM, toAnchor: TOP, label: 'Yes' },
          { from: 'a', to: 'a2', fromAnchor: BOTTOM, toAnchor: TOP, label: 'No' },
          { from: 'b', to: 'b1', fromAnchor: BOTTOM, toAnchor: TOP, label: 'Yes' },
          { from: 'b', to: 'b2', fromAnchor: BOTTOM, toAnchor: TOP, label: 'No' },
        ],
        'Map a choice and its consequences.',
      ),
  },
  {
    id: 'process-map',
    name: 'Process Map',
    description: 'A left-to-right run of steps with inputs and outputs.',
    category: 'Business',
    build: () =>
      buildTemplateDocument(
        'Process Map',
        [
          { id: 'start', shape: 'terminator', x: 60, y: 200, text: 'Request received', style: GREEN },
          { id: 'input', shape: 'data', x: 240, y: 194, text: 'Collect details' },
          { id: 'review', shape: 'process', x: 440, y: 194, text: 'Review' },
          { id: 'check', shape: 'decision', x: 630, y: 180, text: 'Complete?' },
          { id: 'rework', shape: 'process', x: 620, y: 340, text: 'Request more information', style: AMBER },
          { id: 'record', shape: 'document', x: 830, y: 186, text: 'File the record' },
          { id: 'end', shape: 'terminator', x: 1030, y: 200, text: 'Closed', style: ROSE },
        ],
        [
          { from: 'start', to: 'input', fromAnchor: RIGHT, toAnchor: LEFT },
          { from: 'input', to: 'review', fromAnchor: RIGHT, toAnchor: LEFT },
          { from: 'review', to: 'check', fromAnchor: RIGHT, toAnchor: LEFT },
          { from: 'check', to: 'record', fromAnchor: RIGHT, toAnchor: LEFT, label: 'Yes' },
          { from: 'check', to: 'rework', fromAnchor: BOTTOM, toAnchor: TOP, label: 'No' },
          { from: 'rework', to: 'review', fromAnchor: LEFT, toAnchor: BOTTOM },
          { from: 'record', to: 'end', fromAnchor: RIGHT, toAnchor: LEFT },
        ],
        'Show a business process end to end.',
      ),
  },
  {
    id: 'swimlane',
    name: 'Cross-functional Flowchart',
    description: 'Three swimlanes showing who does what.',
    category: 'Business',
    build: () =>
      buildTemplateDocument(
        'Cross-functional Flowchart',
        [
          { id: 'lane1', shape: 'swimlane', x: 40, y: 60, width: 900, height: 180, text: 'Customer' },
          { id: 'lane2', shape: 'swimlane', x: 40, y: 240, width: 900, height: 180, text: 'Support' },
          { id: 'lane3', shape: 'swimlane', x: 40, y: 420, width: 900, height: 180, text: 'Engineering' },
          { id: 'submit', shape: 'terminator', x: 220, y: 122, text: 'Submit request', style: GREEN },
          { id: 'triage', shape: 'process', x: 400, y: 298, text: 'Triage' },
          { id: 'decide', shape: 'decision', x: 600, y: 288, text: 'Needs a fix?' },
          { id: 'fix', shape: 'process', x: 600, y: 478, text: 'Build the fix' },
          { id: 'reply', shape: 'process', x: 780, y: 298, text: 'Reply to customer' },
          { id: 'done', shape: 'terminator', x: 780, y: 122, text: 'Resolved', style: ROSE },
        ],
        [
          { from: 'submit', to: 'triage', fromAnchor: BOTTOM, toAnchor: TOP },
          { from: 'triage', to: 'decide', fromAnchor: RIGHT, toAnchor: LEFT },
          { from: 'decide', to: 'fix', fromAnchor: BOTTOM, toAnchor: TOP, label: 'Yes' },
          { from: 'fix', to: 'reply', fromAnchor: RIGHT, toAnchor: BOTTOM },
          { from: 'decide', to: 'reply', fromAnchor: RIGHT, toAnchor: LEFT, label: 'No' },
          { from: 'reply', to: 'done', fromAnchor: TOP, toAnchor: BOTTOM },
        ],
        'Assign each step to a team.',
      ),
  },
  {
    id: 'software-logic',
    name: 'Software Logic Flow',
    description: 'Input validation, a branch, and error handling.',
    category: 'Technical',
    build: () =>
      buildTemplateDocument(
        'Software Logic Flow',
        [
          { id: 'start', shape: 'terminator', x: 320, y: 40, text: 'Request', style: GREEN },
          { id: 'parse', shape: 'process', x: 315, y: 130, text: 'Parse input' },
          { id: 'valid', shape: 'decision', x: 315, y: 230, text: 'Valid?' },
          { id: 'error', shape: 'process', x: 90, y: 240, text: 'Return 400', style: ROSE },
          { id: 'load', shape: 'predefined-process', x: 310, y: 360, text: 'Load record' },
          { id: 'found', shape: 'decision', x: 315, y: 460, text: 'Found?' },
          { id: 'notfound', shape: 'process', x: 90, y: 470, text: 'Return 404', style: ROSE },
          { id: 'db', shape: 'database', x: 560, y: 350, text: 'Store', style: SLATE },
          { id: 'ok', shape: 'process', x: 315, y: 590, text: 'Return 200', style: GREEN },
        ],
        [
          { from: 'start', to: 'parse', fromAnchor: BOTTOM, toAnchor: TOP },
          { from: 'parse', to: 'valid', fromAnchor: BOTTOM, toAnchor: TOP },
          { from: 'valid', to: 'error', fromAnchor: LEFT, toAnchor: RIGHT, label: 'No' },
          { from: 'valid', to: 'load', fromAnchor: BOTTOM, toAnchor: TOP, label: 'Yes' },
          { from: 'load', to: 'db', fromAnchor: RIGHT, toAnchor: LEFT, kind: 'straight', style: { strokeStyle: 'dashed', endMarker: 'open-arrow' } },
          { from: 'load', to: 'found', fromAnchor: BOTTOM, toAnchor: TOP },
          { from: 'found', to: 'notfound', fromAnchor: LEFT, toAnchor: RIGHT, label: 'No' },
          { from: 'found', to: 'ok', fromAnchor: BOTTOM, toAnchor: TOP, label: 'Yes' },
        ],
        'Document how a request is handled.',
      ),
  },
  {
    id: 'customer-journey',
    name: 'Customer Journey Flow',
    description: 'Five stages with the touch point at each one.',
    category: 'Business',
    build: () =>
      buildTemplateDocument(
        'Customer Journey Flow',
        [
          { id: 'p1', shape: 'phase', x: 60, y: 60, width: 190, height: 380, text: 'Awareness' },
          { id: 'p2', shape: 'phase', x: 260, y: 60, width: 190, height: 380, text: 'Consideration' },
          { id: 'p3', shape: 'phase', x: 460, y: 60, width: 190, height: 380, text: 'Purchase' },
          { id: 'p4', shape: 'phase', x: 660, y: 60, width: 190, height: 380, text: 'Onboarding' },
          { id: 'p5', shape: 'phase', x: 860, y: 60, width: 190, height: 380, text: 'Advocacy' },
          { id: 's1', shape: 'rounded-rectangle', x: 85, y: 150, width: 140, height: 60, text: 'Sees an ad' },
          { id: 's2', shape: 'rounded-rectangle', x: 285, y: 150, width: 140, height: 60, text: 'Reads reviews' },
          { id: 's3', shape: 'rounded-rectangle', x: 485, y: 150, width: 140, height: 60, text: 'Buys', style: GREEN },
          { id: 's4', shape: 'rounded-rectangle', x: 685, y: 150, width: 140, height: 60, text: 'First use' },
          { id: 's5', shape: 'rounded-rectangle', x: 885, y: 150, width: 140, height: 60, text: 'Recommends', style: AMBER },
          { id: 'n1', shape: 'annotation', x: 85, y: 280, width: 140, height: 90, text: 'Channel: social' },
          { id: 'n3', shape: 'annotation', x: 485, y: 280, width: 140, height: 90, text: 'Channel: website' },
          { id: 'n5', shape: 'annotation', x: 885, y: 280, width: 140, height: 90, text: 'Channel: referral' },
        ],
        [
          { from: 's1', to: 's2', fromAnchor: RIGHT, toAnchor: LEFT, kind: 'straight' },
          { from: 's2', to: 's3', fromAnchor: RIGHT, toAnchor: LEFT, kind: 'straight' },
          { from: 's3', to: 's4', fromAnchor: RIGHT, toAnchor: LEFT, kind: 'straight' },
          { from: 's4', to: 's5', fromAnchor: RIGHT, toAnchor: LEFT, kind: 'straight' },
        ],
        'Follow a customer from first contact to advocacy.',
      ),
  },
  {
    id: 'approval-workflow',
    name: 'Approval Workflow',
    description: 'A request with two levels of approval and a rejection path.',
    category: 'Business',
    build: () =>
      buildTemplateDocument(
        'Approval Workflow',
        [
          { id: 'req', shape: 'terminator', x: 320, y: 50, text: 'Request raised', style: GREEN },
          { id: 'mgr', shape: 'decision', x: 315, y: 160, text: 'Manager approves?' },
          { id: 'fin', shape: 'decision', x: 315, y: 310, text: 'Finance approves?' },
          { id: 'reject', shape: 'process', x: 80, y: 230, text: 'Reject and notify', style: ROSE },
          { id: 'pay', shape: 'process', x: 315, y: 460, text: 'Release payment' },
          { id: 'record', shape: 'document', x: 315, y: 570, text: 'Record in ledger' },
          { id: 'end', shape: 'terminator', x: 320, y: 690, text: 'Complete', style: ROSE },
        ],
        [
          { from: 'req', to: 'mgr', fromAnchor: BOTTOM, toAnchor: TOP },
          { from: 'mgr', to: 'fin', fromAnchor: BOTTOM, toAnchor: TOP, label: 'Approved' },
          { from: 'mgr', to: 'reject', fromAnchor: LEFT, toAnchor: TOP, label: 'Rejected' },
          { from: 'fin', to: 'reject', fromAnchor: LEFT, toAnchor: BOTTOM, label: 'Rejected' },
          { from: 'fin', to: 'pay', fromAnchor: BOTTOM, toAnchor: TOP, label: 'Approved' },
          { from: 'pay', to: 'record', fromAnchor: BOTTOM, toAnchor: TOP },
          { from: 'record', to: 'end', fromAnchor: BOTTOM, toAnchor: TOP },
        ],
        'Show who signs off and what happens when they do not.',
      ),
  },
  {
    id: 'incident-response',
    name: 'Incident Response Workflow',
    description: 'Detect, assess, mitigate, and review.',
    category: 'Technical',
    build: () =>
      buildTemplateDocument(
        'Incident Response Workflow',
        [
          { id: 'detect', shape: 'terminator', x: 320, y: 40, text: 'Alert fires', style: ROSE },
          { id: 'ack', shape: 'process', x: 315, y: 140, text: 'Acknowledge' },
          { id: 'sev', shape: 'decision', x: 315, y: 240, text: 'Severity 1?' },
          { id: 'page', shape: 'process', x: 80, y: 250, text: 'Page the on-call lead', style: AMBER },
          { id: 'mitigate', shape: 'process', x: 315, y: 380, text: 'Mitigate' },
          { id: 'verify', shape: 'decision', x: 315, y: 480, text: 'Service healthy?' },
          { id: 'comm', shape: 'document', x: 570, y: 380, text: 'Update status page' },
          { id: 'review', shape: 'process', x: 315, y: 620, text: 'Post-incident review' },
          { id: 'close', shape: 'terminator', x: 320, y: 730, text: 'Closed', style: GREEN },
        ],
        [
          { from: 'detect', to: 'ack', fromAnchor: BOTTOM, toAnchor: TOP },
          { from: 'ack', to: 'sev', fromAnchor: BOTTOM, toAnchor: TOP },
          { from: 'sev', to: 'page', fromAnchor: LEFT, toAnchor: RIGHT, label: 'Yes' },
          { from: 'sev', to: 'mitigate', fromAnchor: BOTTOM, toAnchor: TOP, label: 'No' },
          { from: 'page', to: 'mitigate', fromAnchor: BOTTOM, toAnchor: LEFT },
          { from: 'mitigate', to: 'comm', fromAnchor: RIGHT, toAnchor: LEFT, kind: 'straight' },
          { from: 'mitigate', to: 'verify', fromAnchor: BOTTOM, toAnchor: TOP },
          { from: 'verify', to: 'mitigate', fromAnchor: RIGHT, toAnchor: RIGHT, label: 'No' },
          { from: 'verify', to: 'review', fromAnchor: BOTTOM, toAnchor: TOP, label: 'Yes' },
          { from: 'review', to: 'close', fromAnchor: BOTTOM, toAnchor: TOP },
        ],
        'Give the on-call team one page to follow.',
      ),
  },
  {
    id: 'sales-funnel',
    name: 'Sales Funnel Workflow',
    description: 'Lead to closed deal, with the drop-off at each stage.',
    category: 'Business',
    build: () =>
      buildTemplateDocument(
        'Sales Funnel Workflow',
        [
          { id: 'lead', shape: 'process', x: 340, y: 60, width: 320, height: 56, text: 'Leads' },
          { id: 'qual', shape: 'process', x: 380, y: 156, width: 240, height: 56, text: 'Qualified' },
          { id: 'demo', shape: 'process', x: 410, y: 252, width: 180, height: 56, text: 'Demo booked', style: AMBER },
          { id: 'prop', shape: 'process', x: 435, y: 348, width: 130, height: 56, text: 'Proposal', style: AMBER },
          { id: 'won', shape: 'process', x: 455, y: 444, width: 90, height: 56, text: 'Won', style: GREEN },
          { id: 'lost', shape: 'process', x: 720, y: 252, width: 130, height: 56, text: 'Lost', style: ROSE },
          { id: 'note', shape: 'annotation', x: 60, y: 150, width: 200, height: 120, text: 'Track the conversion rate between each stage.' },
        ],
        [
          { from: 'lead', to: 'qual', fromAnchor: BOTTOM, toAnchor: TOP },
          { from: 'qual', to: 'demo', fromAnchor: BOTTOM, toAnchor: TOP },
          { from: 'demo', to: 'prop', fromAnchor: BOTTOM, toAnchor: TOP },
          { from: 'prop', to: 'won', fromAnchor: BOTTOM, toAnchor: TOP },
          { from: 'demo', to: 'lost', fromAnchor: RIGHT, toAnchor: LEFT, label: 'No fit' },
          { from: 'prop', to: 'lost', fromAnchor: RIGHT, toAnchor: BOTTOM, label: 'No decision' },
        ],
        'See where deals are lost.',
      ),
  },
  {
    id: 'project-workflow',
    name: 'Project Workflow',
    description: 'Four phases with a gate between each one.',
    category: 'Business',
    build: () =>
      buildTemplateDocument(
        'Project Workflow',
        [
          { id: 'init', shape: 'terminator', x: 60, y: 200, text: 'Kick off', style: GREEN },
          { id: 'plan', shape: 'process', x: 230, y: 194, text: 'Plan' },
          { id: 'g1', shape: 'decision', x: 410, y: 180, width: 110, height: 80, text: 'Gate 1' },
          { id: 'build', shape: 'process', x: 570, y: 194, text: 'Build' },
          { id: 'g2', shape: 'decision', x: 750, y: 180, width: 110, height: 80, text: 'Gate 2' },
          { id: 'launch', shape: 'process', x: 910, y: 194, text: 'Launch' },
          { id: 'retro', shape: 'document', x: 910, y: 330, text: 'Retrospective' },
          { id: 'rework', shape: 'process', x: 560, y: 340, text: 'Revise the plan', style: AMBER },
          { id: 'end', shape: 'terminator', x: 1090, y: 200, text: 'Closed', style: ROSE },
        ],
        [
          { from: 'init', to: 'plan', fromAnchor: RIGHT, toAnchor: LEFT },
          { from: 'plan', to: 'g1', fromAnchor: RIGHT, toAnchor: LEFT },
          { from: 'g1', to: 'build', fromAnchor: RIGHT, toAnchor: LEFT, label: 'Pass' },
          { from: 'g1', to: 'rework', fromAnchor: BOTTOM, toAnchor: TOP, label: 'Fail' },
          { from: 'rework', to: 'plan', fromAnchor: LEFT, toAnchor: BOTTOM },
          { from: 'build', to: 'g2', fromAnchor: RIGHT, toAnchor: LEFT },
          { from: 'g2', to: 'launch', fromAnchor: RIGHT, toAnchor: LEFT, label: 'Pass' },
          { from: 'g2', to: 'rework', fromAnchor: BOTTOM, toAnchor: RIGHT, label: 'Fail' },
          { from: 'launch', to: 'retro', fromAnchor: BOTTOM, toAnchor: TOP },
          { from: 'launch', to: 'end', fromAnchor: RIGHT, toAnchor: LEFT },
        ],
        'Run a project through staged approvals.',
      ),
  },
];

export const TEMPLATES: readonly TemplateDefinition[] = templates;

export function getTemplate(id: string): TemplateDefinition | undefined {
  return templates.find((template) => template.id === id);
}
