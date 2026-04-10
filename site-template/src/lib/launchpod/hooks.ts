// Hooks engine — executes post-create and post-update actions
import fs from 'node:fs';
import path from 'node:path';
import type { HookDefinition } from './models.js';

export async function executeHooks(
  hooks: HookDefinition[] | undefined,
  record: Record<string, any>,
  projectRoot?: string
): Promise<void> {
  if (!hooks || hooks.length === 0) return;

  for (const hook of hooks) {
    try {
      switch (hook.action) {
        case 'email':
          await sendEmailHook(hook, record, projectRoot);
          break;
        case 'webhook':
          await callWebhook(hook, record);
          break;
      }
    } catch (error) {
      console.error(`Hook execution failed (${hook.action}):`, error);
      // Hooks fail silently — don't block the API response
    }
  }
}

async function sendEmailHook(
  hook: HookDefinition,
  record: Record<string, any>,
  projectRoot?: string
): Promise<void> {
  if (!hook.template) return;

  const root = projectRoot || process.cwd();
  const templatePath = path.join(root, 'backend', 'email-templates', `${hook.template}.html`);

  if (!fs.existsSync(templatePath)) {
    console.error(`Email template not found: ${templatePath}`);
    return;
  }

  let html = fs.readFileSync(templatePath, 'utf-8');

  // Substitute {{ fieldName }} placeholders
  for (const [key, value] of Object.entries(record)) {
    html = html.replace(new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'g'), String(value ?? ''));
  }

  // TODO: Send via configured transport (Resend, Postmark, SMTP)
  // For now, log the email
  console.log(`[Hook] Email would be sent:`);
  console.log(`  To: ${hook.to}`);
  console.log(`  Subject: ${hook.subject}`);
  console.log(`  Template: ${hook.template}`);
}

async function callWebhook(
  hook: HookDefinition,
  record: Record<string, any>
): Promise<void> {
  if (!hook.url) return;

  const response = await fetch(hook.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(record),
  });

  if (!response.ok) {
    console.error(`Webhook failed (${hook.url}): ${response.status} ${response.statusText}`);
  }
}
