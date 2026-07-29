import type { MetadataRoute } from 'next';

// Internal portal — must never be indexed. This replaces the previous static
// public/robots.txt, which only disallowed specific paths and would have taken
// precedence over this route had it been left in place.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        disallow: '/'
      }
    ]
  };
}
