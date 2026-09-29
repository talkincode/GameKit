# Agent 编码规范 (Agent Coding Guidelines)

> [!IMPORTANT]
> **最高优先级规则 (Highest Priority Guideline)**
>
> 本文档中定义的 **Agent 编码规范 (Agent Coding Guidelines)** 拥有**最高优先级**。所有 Agent 在本仓库进行任何代码编写、修改、重构或测试时，必须无条件优先遵循本准则。
> 当审美纯洁度、抽象偏好或大规模重构冲动与本准则冲突时，以本准则为准。

## Agent Coding Guidelines

The goal is not "beautiful code."

The goal is code with **clear structure, explicit logic, strong verifiability, and low-cost changeability** — code that the next agent or person can understand, trace, safely modify, and verify without having watched it being written.

### The four questions

Every change is judged by these. Ask them before you start and before you finish:

1. Can someone quickly understand the structure this change touches?
2. Can they accurately trace the logic and state changes from input to output?
3. Can they safely modify this part without breaking something elsewhere?
4. Can they verify the change is correct, using evidence you left behind?

If any answer is no, the change is not done.

### Priority

**Correctness → Structure → Logic → Verifiability → Locality → Performance → Elegance**

When two rules below conflict, the one higher in this list wins. In particular: fixing a root cause that spans modules beats a local patch that leaves the wrong rule in place (Structure > Locality). Say so explicitly when you do this.

---

### 1. Understand before you change

* Read the code you are about to modify and the code that calls it. Know what currently happens before deciding what should happen.
* Before adding anything — a helper, a config option, a state field, an abstraction layer — look for the existing equivalent. Reuse the project's existing conventions and sources of truth.
* If you introduce a new concept, state why the existing ones were insufficient.
* Match the project's existing idioms, even where you would personally choose differently. Consistency within the codebase beats consistency with your preferences.

### 2. Prefer clear structure

* Every module has one responsibility you can state in a sentence or two. If you can't, the boundary is wrong.
* Inputs, outputs, dependencies, and sources of state are visible at the module boundary.
* No hidden dependencies, ambient global state, or side effects that reach across modules.
* Prefer self-contained modules over cross-layer coupling.

### 3. Prefer explicit logic

* Data flow is traceable from input to output by reading the code, without running it.
* State changes are explicit and localized; a reader can find every place a piece of state is written.
* Do not introduce indirection or dynamic mechanisms (reflection, metaprogramming, plugin systems, implicit dispatch) that the project does not already use.
* Prefer direct code over abstractions that exist only to look elegant. Some duplication is better than the wrong abstraction.

### 4. Keep changes local — but fix the rule, not the symptom

* Solve the task with the smallest change that fixes the actual cause.
* One requirement should touch as few modules as possible.
* Do not refactor, reformat, or "improve" code unrelated to the task. Leave it as you found it.
* When the fix requires touching several modules because the *rule* is wrong (not just one instance of it), do it — and identify the root cause in your summary so reviewers can see why the change is broader than the symptom.

### 5. Make behavior verifiable

* When behavior changes, add or update tests that exercise the real behavior. Tests exist to catch regressions, not to raise coverage.
* Verify the change the way it will actually be used: run the real command, hit the real endpoint, render the real output. Passing tests are evidence, not the finish line.
* Prefer deterministic, reproducible implementations. Avoid time-, order-, or environment-dependent behavior unless the task requires it.
* A completed change states *how* it was verified and why that method reflects real use.

### 6. Fail explicitly

* Validate inputs and assumptions at system boundaries.
* Errors are returned or logged with enough context to diagnose them. Unexpected states are surfaced, never silently swallowed.
* Never weaken an assertion, mock away a real code path, or catch-and-ignore to make a test pass. If a test is wrong, fix the test and say why it was wrong.

### 7. Protect the working system

* Preserve existing behavior and compatibility unless the change is intentionally breaking. If it is, say so.
* Prefer small, reviewable, reversible changes over large ones.
* Do not delete or rewrite code you do not understand. If something looks dead or wrong, confirm before removing it.

### 8. Decide visibly; ask when the decision isn't yours

* When more than one reasonable approach exists, compare them briefly and pick a clear winner. Record the reasoning where the next reader will find it (PR description, commit message, or a short comment at the decision point).
* When the tradeoff is a real product or architectural choice — not a technical detail — recommend a direction and stop to confirm before building it.
* If the available context doesn't let you proceed safely, ask one specific question instead of guessing.
* Leave behind what a reviewer needs: what changed, why, what was considered and rejected, and how it was verified.

---

### Definition of done

A change is complete when:

* the requested outcome actually works, verified in the way it will be used;
* it fits the surrounding system's existing structure and conventions;
* tests cover the changed behavior and none were weakened to pass;
* unrelated code is untouched;
* the reasoning behind non-obvious decisions is written down;
* the four questions at the top all answer yes.
