# Misc Follow-ups

> **Status: not started.** A backlog of things to look into once plans
> [05](05-clarity-fixes-plan.md), [06](06-map-interaction-plan.md) and
> [07](07-explanatory-pages-plan.md) are done. Each item is a question to investigate, not a
> decided change. Add to it as things come up.

## 1. Rejected combinations that still say `accepted: true`

**Seen in:** `#/combo/north_pole/shapely/raw` (found while verifying plan 06).

`runner._score` marks a combination `rejected` when the library refused the polygon
(`accepted` is false) **or** when the library reported validation errors on a polygon that
`expected_valid` says is valid. The second case keeps `accepted: true`. In this combination,
Shapely built the polygon but `is_valid` reported a self-intersection.

The results file therefore holds `outcome: "rejected"` next to `accepted: true`. The detail page
decides whether to draw the submitted geometry from `accepted`, not from the outcome, so this
"rejected" combination still shows a submitted geometry and a library bounding box. Every other
rejected combination shows neither.

Questions to settle:

* Is this correct? The library did build *something*, and drawing it may be the most useful
  explanation of why it was rejected (here, the zigzag band below the ring).
* If it stays, should the page say so? For example: "Shapely built this shape but its own
  validation rejected it."
* If it goes, should the runner set `accepted: false` in this case, or should the front end draw
  from the outcome? `accepted`'s description ("Whether the library took the polygon without
  rejecting it") suggests the data is the inconsistent part.
* Should the outcome split in two, so "refused" and "built but reported invalid" can be told
  apart?

## 2. Point hovers

Ideally hovering over a point would show some kind of information

## 3. Better styling and organization of data on the page

I'm not a big fan of how things are laid out now. I'd like to do some analysis of a better layout for information that will make it easier for people to understand.
