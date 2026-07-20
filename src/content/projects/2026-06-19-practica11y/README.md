---
title: 'Practica11y'
description: A gamified, browser-based learning platform for web accessibility. Developers solve interactive challenges directly in the browser to learn the practical implementation of accessibility and WCAG guidelines.
published: true
author:
  name: Danny Koppenhagen
  mail: mail@k9n.dev
updated: 2026-07-20
keywords:
  - Accessibility
  - a11y
  - WCAG
  - Angular
  - Learning
  - Gamification
language: en
thumbnail:
  header: ./practica11y_header.png
  card: ./practica11y_header.png
status: active
---

[Practica11y](https://practica11y.dev) is a gamified, browser-based learning platform for web accessibility.
Instead of just reading about accessibility, developers solve interactive challenges directly in the browser and learn the **practical** implementation of inclusive web development.

The mission is to raise awareness for web accessibility, sharpen the understanding of WCAG guidelines, and turn inclusive development into a natural habit.
Whether you are just starting out or deepening your expertise — hands-on practice makes the difference.

The platform is entirely client-side, so there is no backend required. All progress is stored locally in the browser — or synced across devices via GitHub.

![Screenshot of the Practica11y challenge interface](./practica11y_screenshot.png)

## Features

- **Interactive challenges** covering WCAG topics from missing alt text to target size, focus management, media queries and table semantics — solved right in the browser with a built-in Monaco editor
- **Live accessibility analysis** powered by `axe-core` and `dom-accessibility-api`
- **Accessibility tree visualization** to inspect the semantic structure of a solution
- **Virtual screen reader** that simulates how a screen reader announces the preview, with step, auto-play and speed controls (powered by Guidepup and the Web Speech API)
- **Color contrast checker** that lets learners pick elements in the live preview to inspect foreground/background contrast ratios against WCAG 2.1 AA and AAA thresholds
- **Keyboard and focus analysis** with tab order visualization and focused-element tracking to surface focus traps, incorrect tab order and non-focusable interactive elements
- **Diff view editor** to compare the current solution against the starter code side-by-side using Monaco's built-in diff view
- **Media query simulation** for `prefers-color-scheme` and `prefers-contrast` directly in the preview panel — no need to toggle OS settings
- **Sandboxed live preview** with link navigation interception for full isolation
- **Instant feedback** via per-challenge validators
- **Random challenge picker** — hit the dice button to jump into a surprise challenge
- **Gamification** with XP, levels and achievements, plus local progress tracking to keep learning motivating
- **Cross-device sync via GitHub** — sign in with GitHub (OAuth Device Flow) to sync progress across devices through a private Gist, with merge-based conflict resolution
- **Responsive mobile navigation** for comfortable use on smaller screens

## Tech Stack

Built with **Angular** (Standalone Components, Signals, Zoneless Change Detection), organized as an **Nx** monorepo, styled with **Tailwind CSS**, and tested with **Vitest**. A lightweight **Cloudflare Worker** handles the GitHub OAuth proxy for cross-device sync.

- **[Practica11y — Website](https://practica11y.dev)**
- **[Practica11y — GitHub Repository](https://github.com/d-koppenhagen/practica11y)**
