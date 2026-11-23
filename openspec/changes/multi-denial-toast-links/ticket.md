# HEL-1172: Multi-pipeline denial toast: link each denied pipeline to its page / Run to update

## Description

origin_kind: followup
origin_ticket: HEL-1096

HEL-1096's post-write toast (`deniedPipelinesToast.ts`) shows a "Run to update" action only when a write denies exactly ONE visible pipeline that the writer `canRun`. When one write denies **two or more** pipelines, the toast lists each pipeline's specific-rule reason but offers no action and no pointer to the pipeline pages, where each pipeline's own "Run to update" lives. A user who doesn't know pipeline detail pages exist has to infer where to go.

The owner accepted this for HEL-1096 on 2026-09-24 and asked for this follow-up. **Correction to the record:** HEL-1096's final-gate report describes the N>1 behaviour as an "explicit owner ruling". It was not. The owner ruled only "Toast notification and pipeline page"; the N>1 shape was a design-gate decision.

## Acceptance criteria

* In a multi-denial toast, each listed pipeline links to its pipeline page. Where `canRun`, it offers a per-pipeline "Run to update" (or a link to it), without a toast storm on rapid writes.
* The toast stays persistent while it holds actions (WCAG 2.2.1) and is keyboard-reachable, with computed ARIA asserted (C8).

## Driver context (verified at Setup)

* `canRun` today (AutoRunTriggerService.handleDenied): pipeline owner -> true unless a step-config-invalid reason; editor grantee -> true unless step-config-invalid (neutral reason text, HEL-1800); viewer grantee -> listed, canRun=false (gets a link, never a run action); no grant -> not listed.
* The pipeline page's own "Run to update" lives in SpineStatusStrip (gated on costVerdict.canRun).
* Do not touch pipeline page components (HEL-1794 in flight). Frontend only, no migration.
