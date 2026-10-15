---
name: TypeScript Type Imports
description: Guidelines for importing types when verbatimModuleSyntax is enabled
---

# TypeScript Type Imports

When importing types in this project, `verbatimModuleSyntax` is enabled in the `tsconfig.json`. 

To prevent `TS1484` syntax errors, you MUST use inline type imports (placing the `type` keyword inside the curly braces) rather than top-level type imports.

**Correct:** 
`import { type MyInterface } from "./module.js";`
`import { myFunction, type MyInterface } from "./module.js";`

**Incorrect:** 
`import type { MyInterface } from "./module.js";`
