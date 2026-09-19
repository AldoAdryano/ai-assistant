# NLP Date Parser Refactoring Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement robust natural language date parsing to solve Gemini's inability to extract Indonesian relative dates properly.

**Architecture:** Create an NLP utility using custom Regex logic in `src/date.ts` to parse relative Indonesian dates ("kamis depan", "kemarin minggu", "besok") into YYYY-MM-DD format. Hook this parser into `src/router.ts`. 

**Tech Stack:** TypeScript, Node.js.

**Spec:** Fix Date extraction.

## Global Constraints

- Must run in Cloudflare Workers (TypeScript).
- Use local simple parser (Regex) instead of heavy external NLP libraries if possible.

---

### Task 1: Create Date Parser Utility

**Files:**
- Modify: `src/date.ts`

**Interfaces:**
- Produces: `parseIndonesianNaturalDate(input: string, referenceDate: Date): string | null`

- [ ] **Step 1: Write NLP Logic**

In `src/date.ts`, enhance the existing date logic to handle words like "besok", "lusa", "kemarin", "hari ini", and days of the week ("senin", "selasa", dll) combined with "depan" or "minggu depan". Return `YYYY-MM-DD` or `null` if parsing fails.

### Task 2: Inject Date Parser into Router

**Files:**
- Modify: `src/router.ts`

**Interfaces:**
- Consumes: `parseIndonesianNaturalDate`

- [ ] **Step 1: Replace simple parsing**

In `src/router.ts` where `create_notion_task` and `update_notion_task` capture `args.due_date`, pass the LLM's raw string through the new `parseIndonesianNaturalDate`. 
Use the resolved date before sending the payload to Notion.