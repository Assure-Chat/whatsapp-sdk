import type {
  InteractiveContent,
  OutboundMessageRequest,
  SendMessageResponse,
  TemplateComponent,
  TemplateMessageContent,
} from '@assure-ai/whatsapp-types';
import { WhatsAppValidationError } from './errors.js';

/**
 * Request- and response-boundary validation.
 *
 * Request validation catches the mistakes Meta does *not* catch — the ones
 * that produce a 200 and a broken message. The most dangerous is a positional
 * template parameter list that does not match the approved body: Meta accepts
 * it and renders a blank where the verification code should have been.
 *
 * Response validation is narrow on purpose. The client asserts the fields it
 * indexes into exist and have the right primitive type, and preserves
 * everything else untouched. Meta adds response fields continuously, and a
 * strict schema here would start rejecting real traffic.
 */

function reject(message: string): never {
  throw new WhatsAppValidationError({
    status: 0,
    message,
    method: 'CLIENT',
    operation: 'validate',
  });
}

const MAX_TEMPLATE_NAME_LENGTH = 512;
const MAX_REPLY_BUTTONS = 3;
const MAX_LIST_ROWS = 10;
const MAX_LIST_SECTIONS = 10;

/**
 * Validate a template message before it is sent.
 *
 * Checks structure and ordering, not approval. Whether the template exists, is
 * APPROVED, and is approved *in this language* are provider facts this client
 * cannot know without a round trip — and a cached answer to them would be
 * wrong the moment Meta pauses the template.
 */
export function validateTemplateContent(template: TemplateMessageContent): void {
  if (typeof template.name !== 'string' || template.name === '') {
    reject('template.name is required');
  }
  if (template.name.length > MAX_TEMPLATE_NAME_LENGTH) {
    reject(`template.name exceeds ${MAX_TEMPLATE_NAME_LENGTH} characters`);
  }
  if (
    !template.language ||
    typeof template.language.code !== 'string' ||
    template.language.code === ''
  ) {
    reject('template.language.code is required — pass the locale the template was approved in');
  }

  const components = template.components ?? [];
  if (!Array.isArray(components)) reject('template.components must be an array');

  let headerCount = 0;
  let bodyCount = 0;
  const buttonIndexes = new Set<string>();

  for (const component of components) {
    validateComponent(component);
    if (component.type === 'header') {
      headerCount += 1;
      if (headerCount > 1) reject('a template message may carry at most one header component');
    }
    if (component.type === 'body') {
      bodyCount += 1;
      if (bodyCount > 1) reject('a template message may carry at most one body component');
    }
    if (component.type === 'button') {
      if (buttonIndexes.has(component.index)) {
        // Two payloads for one button: Meta takes one of them, unpredictably.
        reject(`duplicate button index "${component.index}" in template components`);
      }
      buttonIndexes.add(component.index);
    }
  }

  // Button indexes are positions in the approved template and must start at 0
  // and be contiguous. A gap means a button was skipped, which silently sends
  // the wrong payload to the wrong button.
  if (buttonIndexes.size > 0) {
    const sorted = [...buttonIndexes].map(Number).sort((a, b) => a - b);
    for (const [position, index] of sorted.entries()) {
      if (index !== position) {
        reject(
          'template button components must have contiguous indexes starting at "0" — ' +
            `got ${JSON.stringify([...buttonIndexes])}`,
        );
      }
    }
  }
}

function validateComponent(component: TemplateComponent): void {
  if (!component || typeof component !== 'object')
    reject('each template component must be an object');

  if (component.type === 'button') {
    if (!/^\d+$/.test(component.index)) {
      reject('template button component `index` must be a non-negative integer as a string');
    }
    if (!Array.isArray(component.parameters) || component.parameters.length !== 1) {
      reject('a template button component takes exactly one parameter');
    }
    return;
  }

  if (component.type !== 'header' && component.type !== 'body') {
    reject(
      `unsupported template component type "${String((component as { type: unknown }).type)}"`,
    );
  }

  if (!Array.isArray(component.parameters)) {
    reject(`template ${component.type} component requires a parameters array`);
  }

  let named = 0;
  for (const parameter of component.parameters) {
    if (!parameter || typeof parameter !== 'object' || typeof parameter.type !== 'string') {
      reject(`template ${component.type} parameters must each be an object with a type`);
    }
    if (parameter.type === 'text' && typeof parameter.text !== 'string') {
      reject('a text template parameter requires a string `text`');
    }
    if ('parameter_name' in parameter && parameter.parameter_name !== undefined) named += 1;
  }

  // A component that mixes named and positional parameters is rejected by
  // Meta — but only sometimes, so it is caught here deterministically.
  if (named > 0 && named !== component.parameters.length) {
    reject(
      `template ${component.type} component mixes named and positional parameters — ` +
        'a component must use one convention throughout',
    );
  }
}

/** Validate an interactive message's structure and Meta's documented limits. */
export function validateInteractiveContent(interactive: InteractiveContent): void {
  if (!interactive || typeof interactive !== 'object') reject('interactive content is required');
  if (
    !interactive.body ||
    typeof interactive.body.text !== 'string' ||
    interactive.body.text === ''
  ) {
    reject('interactive.body.text is required');
  }

  if (interactive.type === 'button') {
    const buttons = interactive.action?.buttons;
    if (!Array.isArray(buttons) || buttons.length === 0) {
      reject('an interactive button message requires at least one reply button');
    }
    if (buttons.length > MAX_REPLY_BUTTONS) {
      reject(`an interactive button message takes at most ${MAX_REPLY_BUTTONS} reply buttons`);
    }
    const ids = new Set<string>();
    for (const button of buttons) {
      if (
        button?.type !== 'reply' ||
        typeof button.reply?.id !== 'string' ||
        button.reply.id === ''
      ) {
        reject('each interactive button requires `reply.id`');
      }
      if (typeof button.reply.title !== 'string' || button.reply.title === '') {
        reject('each interactive button requires `reply.title`');
      }
      if (ids.has(button.reply.id)) {
        // Duplicate IDs make the webhook ambiguous about which was tapped.
        reject(`duplicate interactive button id "${button.reply.id}"`);
      }
      ids.add(button.reply.id);
    }
    return;
  }

  if (interactive.type === 'list') {
    const action = interactive.action;
    if (typeof action?.button !== 'string' || action.button === '') {
      reject('an interactive list message requires `action.button`');
    }
    if (!Array.isArray(action.sections) || action.sections.length === 0) {
      reject('an interactive list message requires at least one section');
    }
    if (action.sections.length > MAX_LIST_SECTIONS) {
      reject(`an interactive list message takes at most ${MAX_LIST_SECTIONS} sections`);
    }
    const ids = new Set<string>();
    let rowCount = 0;
    for (const section of action.sections) {
      if (!Array.isArray(section?.rows) || section.rows.length === 0) {
        reject('each interactive list section requires at least one row');
      }
      for (const row of section.rows) {
        if (typeof row?.id !== 'string' || row.id === '') reject('each list row requires an `id`');
        if (typeof row.title !== 'string' || row.title === '') {
          reject('each list row requires a `title`');
        }
        if (ids.has(row.id)) reject(`duplicate interactive list row id "${row.id}"`);
        ids.add(row.id);
        rowCount += 1;
      }
    }
    if (rowCount > MAX_LIST_ROWS) {
      reject(`an interactive list message takes at most ${MAX_LIST_ROWS} rows in total`);
    }
    return;
  }

  reject(`unsupported interactive type "${String((interactive as { type: unknown }).type)}"`);
}

/** Validate any outbound message before it leaves the process. */
export function validateOutboundMessage(message: OutboundMessageRequest): void {
  if (!message || typeof message !== 'object') reject('a message object is required');
  if (message.messaging_product !== 'whatsapp') {
    reject('messaging_product must be "whatsapp"');
  }
  if (typeof message.to !== 'string' || message.to === '') reject('`to` is required');

  switch (message.type) {
    case 'text':
      if (typeof message.text?.body !== 'string' || message.text.body === '') {
        reject('text.body is required on a text message');
      }
      return;
    case 'template':
      validateTemplateContent(message.template);
      return;
    case 'interactive':
      validateInteractiveContent(message.interactive);
      return;
    default:
      // Exhaustive over the union; the assignment fails to compile if an arm
      // is added without a branch here.
      return assertNever(message, 'message type');
  }
}

/**
 * Validate the shape of a send response.
 *
 * The client indexes into `messages[0].id`, so that path is asserted. Anything
 * beyond it is passed through untouched.
 */
export function validateSendResponse(payload: unknown, operation: string): SendMessageResponse {
  if (!payload || typeof payload !== 'object') {
    reject(`${operation} returned a non-object body`);
  }
  const response = payload as SendMessageResponse;
  if (response.messaging_product !== 'whatsapp') {
    reject(`${operation} returned an unexpected messaging_product`);
  }
  if (response.messages !== undefined) {
    if (!Array.isArray(response.messages)) {
      reject(`${operation} returned a non-array \`messages\``);
    }
    for (const message of response.messages) {
      if (typeof message?.id !== 'string' || message.id === '') {
        reject(`${operation} returned a message without an id`);
      }
    }
  }
  return response;
}

/** Assert a switch is exhaustive. @internal */
export function assertNever(value: never, what: string): never {
  reject(`unhandled ${what}: ${JSON.stringify(value)}`);
}
