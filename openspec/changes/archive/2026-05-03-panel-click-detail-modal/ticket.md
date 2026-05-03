# HEL-173 — Panel click handler opens detail modal

## Title
Panel click handler opens detail modal

## Description
Clicking the panel body opens the detail modal. Grid drag and resize handles must not trigger the modal. Distinguish click vs. drag intent to avoid false opens during layout editing.

## Acceptance Criteria
- Clicking the panel body (not on a drag handle or resize handle) opens the panel detail modal.
- Dragging a panel to reposition it does NOT open the modal.
- Resizing a panel does NOT open the modal.
- The distinction between a click and a drag/resize is reliable (e.g., based on pointer movement delta or mousedown/mouseup displacement).

## Priority
High

## Project
Helio v1.2 — Panel System

## Parent
HEL-139
