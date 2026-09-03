# Founder Pro sign-in design QA

> Historical visual review. The absolute/local paths below are provenance notes,
> not publicly reproducible attachments or current UI proof. The current product
> image is linked from the [root README](../../README.md).


- Source visual truth: `/var/folders/p7/zm_9jr1d1kq_9whrvkw8ckcc0000gn/T/codex-clipboard-0f1f4787-374e-412b-af15-0114a03bb734.png`
- Implementation screenshot: `/Users/lechiffre/Desktop/Civil_MCP/.artifacts/design-qa/pro-signin-desktop.jpg`
- Full comparison: `/Users/lechiffre/Desktop/Civil_MCP/.artifacts/design-qa/pro-signin-comparison.jpg`
- Focused comparison: `/Users/lechiffre/Desktop/Civil_MCP/.artifacts/design-qa/pro-signin-focus-comparison.jpg`
- Implementation viewport and density: 1280 × 720 CSS px at 1×
- Source pixels and normalization: 2936 × 1614 at 2×; 92 px browser chrome removed, then the 2936 × 1522 page was normalized to 1000 × 518
- Implementation pixels and normalization: 1280 × 720 at 1×, normalized to 1000 × 563
- State: signed-out default Sign in with Founder Pro visible

## Full-view comparison evidence

The source and implementation were placed in one comparison image after browser-chrome removal and width normalization. The revised page preserves the CivilMCP shell, restrained neutral palette, two-card hierarchy, and existing navigation. The Sign in card is intentionally wider than Founder Pro so authentication remains the primary task while the upgrade is still discoverable.

## Focused comparison evidence

The focused comparison verifies the complete conversion surface. The implementation keeps Google first, adds the requested email-and-password form, exposes Forgot password and Create account without duplicated sign-in choices, and restores the Pro card with ฿299 pricing and the correct “100 weekly + 500 monthly top-up” entitlement. The inactive “opening soon” CTA is an expected configuration state until Stripe is connected, not a hidden upgrade.

## Required fidelity surfaces

- Fonts and typography: the established CivilMCP font family, restrained weights, compact eyebrow, clear price hierarchy, and readable small print remain consistent. No visible truncation or awkward heading wrap was found.
- Spacing and layout rhythm: the 1.15/0.85 grid makes Sign in primary and Pro secondary; card padding, 8–10 px radii, dividers, and feature-row spacing are consistent. E2E checks cover the single-column mobile collapse.
- Colors and visual tokens: existing off-white background, neutral cards, black primary actions, blue links, disabled state, and restrained accent outline are preserved.
- Image and icon quality: no raster placeholders, CSS drawings, or approximate assets were added. Existing Lucide icons remain optically aligned and use one stroke family.
- Copy and content: the pricing and entitlement are explicit without claiming an inaccurate 5× monthly allowance. “500-credit Pro top-up every month” distinguishes the paid grant from the weekly Free pool.

## Interactions and accessibility

- Opened Sign in from the primary navigation and verified the form and Pro plan through their accessible roles and names.
- Verified the Pro CTA is visible and correctly disabled while billing is not configured.
- Browser logs contained development-only React/Fast Refresh information and no console errors.
- Production build, security contracts, keyboard states, mobile overflow, and responsive collisions are covered by automated gates; the E2E suite passed 17/17.

## Comparison history

1. Earlier implementation finding — P2: the simplified auth-only screen made Founder Pro undiscoverable.
2. Fix — restored the Pro card beside Sign in, made the auth column wider, set ฿299, and corrected the entitlement to a separate 500-credit monthly top-up.
3. Post-fix evidence — full and focused comparison images show a visible but secondary upgrade surface with the password-based auth flow intact.

## Remaining findings

No actionable P0, P1, or P2 visual findings remain. Stripe configuration is still required before the visible Pro CTA can become an active checkout action.

final result: passed
