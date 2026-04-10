import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const blog = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
  schema: z.object({
    title: z.string(),
    date: z.string(),
    author: z.string().default('Admin'),
    featured_image: z.string().optional(),
    published: z.boolean().default(true),
    description: z.string(),
    tags: z.array(z.string()).default([]),
  }),
});

const services = defineCollection({
  loader: glob({ pattern: '**/*.yaml', base: './src/content/services' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    price: z.string().optional(),
    image: z.string().optional(),
    sort_order: z.number().default(0),
  }),
});

const team = defineCollection({
  loader: glob({ pattern: '**/*.yaml', base: './src/content/team' }),
  schema: z.object({
    name: z.string(),
    role: z.string(),
    bio: z.string(),
    photo: z.string().optional(),
    sort_order: z.number().default(0),
  }),
});

export const collections = { blog, services, team };
