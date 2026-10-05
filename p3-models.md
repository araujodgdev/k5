# p3 model configuration. One line per role. Delete a line to fall back to the skill default.
# `inherit-parent` as a value: the role runs on the parent thread's model (omit the delegate_task model). Entries in a panel list still count toward its fan-out.
# `A || B`: use A; if A is unavailable (missing from orchestrator_capabilities, or the delegate fails to start), use B instead.
# `fast` in the options: serviceTier=priority (Codex Fast tier).
# budget: large (xhigh)
feature, refactoring: claudeAgent/claude-sonnet-5-5 (xhigh) || codex/gpt-6.1-sol (xhigh fast)
bug-fix: claudeAgent/claude-sonnet-5-5 (xhigh) || codex/gpt-6.1-sol (xhigh fast)
perf-issue: claudeAgent/claude-sonnet-5-5 (xhigh) || codex/gpt-6.1-sol (xhigh fast)
hillclimb: claudeAgent/claude-sonnet-5-5 (xhigh) || codex/gpt-6.1-sol (xhigh fast)
judgment and prose: claudeAgent/claude-opus-5-5 (xhigh) || codex/gpt-6-astra (xhigh fast)
hardest tasks: claudeAgent/claude-opus-5-5 (xhigh) || codex/gpt-6-astra (xhigh fast)
how explorer: claudeAgent/claude-sonnet-5-5 (xhigh) || codex/gpt-6.1-sol (xhigh fast)
how explainer: claudeAgent/claude-opus-5-5 (xhigh) || codex/gpt-6-astra (xhigh fast)
why investigators: claudeAgent/claude-sonnet-5-5 (xhigh) || codex/gpt-6.1-sol (xhigh fast)
why synthesizer: claudeAgent/claude-opus-5-5 (xhigh) || codex/gpt-6-astra (xhigh fast)
reflect tooling: claudeAgent/claude-opus-5-5 (xhigh) || codex/gpt-6-astra (xhigh fast)
reflect judgment, divergent, synthesizer: claudeAgent/claude-opus-5-5 (xhigh) || codex/gpt-6-astra (xhigh fast)
arena runners: claudeAgent/claude-opus-5-5 (xhigh) || codex/gpt-6-astra (xhigh fast), codex/gpt-6.1-sol (xhigh), codex/gpt-6.1-sol (xhigh fast)
arena cross-judge pool: claudeAgent/claude-opus-5-5 (xhigh) || codex/gpt-6-astra (xhigh fast), codex/gpt-6.1-sol (xhigh), codex/gpt-6.1-sol (xhigh fast)
swarm workers: claudeAgent/claude-sonnet-5-5 (xhigh) || codex/gpt-6.1-sol (xhigh fast)
architect runners: claudeAgent/claude-opus-5-5 (xhigh) || codex/gpt-6-astra (xhigh fast), codex/gpt-6.1-sol (xhigh), codex/gpt-6.1-sol (xhigh fast)
interrogate reviewers: claudeAgent/claude-opus-5-5 (xhigh) || codex/gpt-6-astra (xhigh fast), codex/gpt-6.1-sol (xhigh), codex/gpt-6.1-sol (xhigh fast)
