---
id: doc-09-typography-symlink
title: Typography Symlink Quirk
---

# Typography Symlink Quirk

`apps/web/styles/typography.css` is a **symlink**, not a regular file. This is a workaround for a webpack resolver bug in Next.js 15 where a certain combination of CSS modules and Tailwind `@layer` directives fails to resolve unless the file is a symlink.

**Do not delete the symlink.** Do not replace it with a regular file. If you need to change typography styles, edit the target of the symlink.
