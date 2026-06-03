---
name: code-structure
description: Service-layer architecture guidance for separating orchestration from reusable operational mechanics. Use when multiple workflows duplicate the same logic, when deciding what belongs in actions versus shared services, when refactoring repeated operational blocks across domain flows, or when adding new features that share mechanics with existing flows.
---

# Code Structure

Use a two-layer separation:

- Actions orchestrate domain rules: why, when, who may do it, state transitions, policy, retries, failure classification, and user-facing errors.
- Services centralize reusable mechanics: how to perform the operation reliably, provider/SDK calls, command execution, readiness checks, and structured operational results.

## Decision Rule

Keep product-flow meaning in actions. Move reusable operational mechanics to services.

Use a service extraction when:

- Two or more callers need the same low-level operation.
- Operational code is being copied between actions.
- A bug fix in one workflow should also apply to another workflow doing the same operation.
- A new feature shares mechanics with an existing flow.

Do not extract when the logic is truly domain-specific and only used by one caller.

## Layer Ownership

Actions own:

- Business rules and domain policy.
- Auth, ownership, and permission checks.
- State transitions and database writes for domain entities.
- Flow-specific retries, failure classification, and user-facing messages.
- Choosing which service capabilities to call.

Services own:

- Provider, SDK, filesystem, network, command, and runtime details.
- Health checks, readiness checks, and low-level retries.
- Reusable normalization or detection mechanics.
- Structured results that actions can interpret.

## Service Function Shape

Design services as composable capability blocks, not one giant flow method.

Prefer:

```ts
createManagedSandbox(...)
prepareRepo(...)
detectPackageManager(...)
installDependencies(...)
runBuildCommand(...)
startSandboxRuntime(...)
```

Each service function should:

- Accept required data as explicit parameters.
- Return structured outputs such as `{ ready, previewUrl, proxyPort }`.
- Avoid hidden global state.
- Avoid direct database or domain-state mutation.
- Make failure explicit through structured results or thrown errors with clear semantics.

## Migration Workflow

When extracting repeated mechanics:

1. Understand or write the flow in action code first.
2. Mark repeated, non-domain operational blocks across callers.
3. Extract only the repeated mechanics into a service.
4. Replace one caller and verify.
5. Replace remaining callers.
6. Keep auth, status transitions, domain policy, and user-facing error classification in actions.
7. Run relevant verification such as typecheck, lint, and focused flow checks.

## Anti-Patterns

Avoid:

- God services that hide all control flow in one huge function.
- Leaky services that mutate domain tables directly.
- Inconsistent APIs with mixed argument styles and error semantics.
- Over-abstraction for logic used by only one caller.
- Services that know too much about product state instead of returning capability results.

## Review Heuristic

When reviewing a proposed refactor, ask:

- Is this operation repeated across at least two callers?
- Does the extracted code describe how to do something, rather than what the product flow means?
- Can each caller still choose strict versus relaxed behavior?
- Are service inputs explicit and outputs structured?
- Would a bug fix in this service benefit all relevant flows without changing domain policy?
