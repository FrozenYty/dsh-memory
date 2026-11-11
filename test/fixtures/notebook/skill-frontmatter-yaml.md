---
triggers: skill, 技能, 消失, 目录里没有, frontmatter, 描述
---

# Malformed frontmatter removes the skill silently — 2026-11-02

A `description:` written as a plain, unquoted YAML scalar containing a colon followed
by a space — `holds the rules: what earns a page` — makes the whole frontmatter a
parse error. The loader skips the file and warns to a stderr nobody reads: the skill
simply vanishes from the catalog.

Quote the value, or keep `: ` out of it. Inside single quotes an apostrophe doubles.

Validate before trusting the write by parsing the frontmatter with the profile's own
`yaml` package — a malformed file produces no runtime error to notice.

Evidence: the skill dropped out of the catalog and returned only after quoting it.