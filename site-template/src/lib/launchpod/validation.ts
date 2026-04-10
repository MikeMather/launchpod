// Validates record data against field definitions from models.yaml
import type { FieldDefinition } from './models.js';

export function validate(
  data: Record<string, any>,
  fields: Record<string, FieldDefinition>
): string[] {
  const errors: string[] = [];

  for (const [name, field] of Object.entries(fields)) {
    const value = data[name];
    const isEmpty = value === undefined || value === null || value === '';

    // Required check
    if (field.required && isEmpty) {
      errors.push(`${name} is required`);
      continue;
    }

    // Skip validation for empty optional fields
    if (isEmpty) continue;

    // Type-specific validation
    switch (field.type) {
      case 'text':
      case 'richtext':
        if (typeof value !== 'string') {
          errors.push(`${name} must be a string`);
        } else if (field.max_length && value.length > field.max_length) {
          errors.push(`${name} must be at most ${field.max_length} characters`);
        }
        break;

      case 'email':
        if (typeof value !== 'string' || !value.includes('@') || !value.includes('.')) {
          errors.push(`${name} must be a valid email address`);
        }
        break;

      case 'url':
        try {
          new URL(value);
        } catch {
          errors.push(`${name} must be a valid URL`);
        }
        break;

      case 'number':
        if (typeof value !== 'number' || isNaN(value)) {
          errors.push(`${name} must be a number`);
        } else {
          if (field.min !== undefined && value < field.min) {
            errors.push(`${name} must be at least ${field.min}`);
          }
          if (field.max !== undefined && value > field.max) {
            errors.push(`${name} must be at most ${field.max}`);
          }
        }
        break;

      case 'boolean':
        if (typeof value !== 'boolean') {
          errors.push(`${name} must be a boolean`);
        }
        break;

      case 'datetime':
        if (isNaN(Date.parse(String(value)))) {
          errors.push(`${name} must be a valid date`);
        }
        break;

      case 'select':
        if (field.options && !field.options.includes(value)) {
          errors.push(`${name} must be one of: ${field.options.join(', ')}`);
        }
        break;

      case 'multiselect':
        if (!Array.isArray(value)) {
          errors.push(`${name} must be an array`);
        } else if (field.options) {
          const invalid = value.filter((v: string) => !field.options!.includes(v));
          if (invalid.length > 0) {
            errors.push(`${name} contains invalid options: ${invalid.join(', ')}`);
          }
        }
        break;

      case 'file':
        if (typeof value !== 'string') {
          errors.push(`${name} must be a file path string`);
        }
        break;

      case 'list':
        if (!Array.isArray(value)) {
          errors.push(`${name} must be an array`);
        }
        break;
    }
  }

  return errors;
}

export function applyDefaults(
  data: Record<string, any>,
  fields: Record<string, FieldDefinition>
): Record<string, any> {
  const result = { ...data };
  for (const [name, field] of Object.entries(fields)) {
    if ((result[name] === undefined || result[name] === null) && field.default !== undefined) {
      result[name] = field.default;
    }
  }
  return result;
}
