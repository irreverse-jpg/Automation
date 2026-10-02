# Turn2us Benefits Calculator: reference journey

A manual walkthrough of the whole Benefits Calculator wizard (`https://staging-beta-benefits-calculator.turn2us.org.uk/`), recorded by Hector Ortega on 2026-09-23/24. It is the source of truth for the `Full Journey (Reference)` test in `05-turn2us.getsupport.spec.js`. Use it when extending that test or building variant journeys, so you don't have to work the wizard out again.

## How to reach it

Homepage → meganav "Get support" → "Benefits Calculator" landing page. The landing page has 3 feature cards, each covered by its own traversal in the spec:

1. **Use the Turn2us Benefits Calculator** opens the wizard below. Same URL as the page's "Get Started" button.
2. **Return to a calculation**: fields `#index_token` / `#index_postcode`, button `#btnFind`.
3. **Your Situation** opens in a new tab.

On the wizard, the page title contains "Benefits Calculator", but the H1 changes with each step (the first screen's H1 is "Before we begin"). Any real H1 is acceptable at each step, so don't assert that the H1 matches the clicked label.

## How the wizard behaves (every step)

- Yes/No and single-select options are clickable tiles. The selected tile turns orange, and changing the selection turns the old tile white again.
- Clicking **Next** with required answers missing shows one validation message per unanswered question. Each answer removes one message, and Next proceeds once all are answered.
- **Back** returns to the previous screen with earlier answers still selected.
- Typed fields (postcode, date of birth, amounts) show a **Change your answer** button when you go Back past them, so you can edit one field without re-entering everything.
- Many sections are conditional. For example, "Working" reveals employment types plus an hours field, and "Yes" to a pension reveals an amount and frequency.

## The recorded journey

All data below is made-up test data.

1. First Yes/No screen: click Next empty first and confirm the validation count drops by one with each answer. Any values are fine.
2. Text-only screen → Back (prior answers still held) → Next → Next.
3. **About you**: Next with nothing filled (validation), then postcode `M335SH`, a Yes/No (either), DOB `27/06/1981` → Next. Go Back, use the postcode's "Change your answer" to set `M336SH`, then Next.
4. **Current Benefits**: a calculation reference appears (readonly `#token`) → Next → one Yes/No → Next.
5. **Health**: Back (still selected) → Next → text-only → Next → one Yes/No → Next.
6. **Caring for someone**: Back → Next → Next.
7. **You as a carer**: one Yes/No → Next.
8. **Children in your life**: text-only → Next → two Yes/No → Next.
9. **Your home** → **About your home**: "I'm in temporary accommodation" → second select "I'm staying in a refuge" → Next. This section branches heavily.
10. **Your Tenancy**: rent `900`, `Monthly` → Next.
11. **Your council tax**: Yes/No, then "Look this up for me" → pick address "41 Barkers Lane" → "Change Band" → "Band A" → Next.
12. **Money and work** → **Your Working Status**: "Working" → employment types "Employed" and "In the reserve forces" → hours per week `40` → Next.
13. **Your Work Income**: employment `50000` Yearly; reserve forces `10000` Yearly; pension Yes → `500` Monthly → Next.
14. **Your War Pensions Income**: No → Next.
15. **Non Work Income**: Yes → `300` Monthly → Next.
16. **Your Savings & Property** → **The Property You Own**: own other property Yes → value `400000` → mortgage No → occupied No → next Yes/No No (close the panel that appears) → Next.
17. **Your Savings And Non-Property Assets**: `125000` → Next.
18. **Your results**: content depends on everything above. Check every button links to a real URL. The "Start Survey" button near the bottom goes to an external site, so only check that its URL is reachable.

## Status as of 2026-10-02

| Item | Status |
|---|---|
| Landing page and feature cards | Done |
| Card 1: full reference journey above | Done, passes on all 3 viewports |
| Card 2: Return to a Calculation | Done, covers both a valid and an invalid reference/postcode |
| Card 3: Your Situation | Done |
| About 10 varied journeys through the wizard's branches | **Not started** |

**Planned next step:** about 10 different realistic journeys, to show that the branching works. Examples: not in temporary accommodation, Not Working, no pension, looking up the council tax band yourself, other rent frequencies. Where a branch isn't covered above, answer the way a real person plausibly would.
