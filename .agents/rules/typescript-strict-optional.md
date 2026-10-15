---
description: Ensure strict optional properties format in TypeScript
---

# TypeScript Exact Optional Properties

When defining optional properties in classes or interfaces (e.g. `foo?: string`), you MUST explicitly include `| undefined` in the type definition (e.g. `foo?: string | undefined;`) because this repository has `exactOptionalPropertyTypes: true` enabled in the `tsconfig.json`.

Failure to do this will cause compilation errors when assigning `undefined` or optional variables to the class properties.
