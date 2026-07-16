---
name: settlement-design
description: Create cities, towns, villages, stations, and other settlements with layered history, spatial logic, infrastructure, districts, social variation, and lived detail. Use for generation or explicit critique.
license: MIT
metadata:
  author: "jwynia; adapted by worldbookllm"
  version: "2.0"
  type: generator
  mode: generative+explicit-critique
  domain: worldbuilding
---

# Settlement Design

Create settlements as accumulated adaptations to site, movement, livelihood, power, danger, and
history.

## Creation Mode

Default to creating the requested settlement, district, neighborhood, map brief, travel account,
infrastructure, civic institution, or urban expansion. Produce concrete setting material rather
than advice on settlement design.

Build from interacting layers:

1. **Site:** water, terrain, climate, resources, hazards, defensibility, and nearby routes.
2. **Reason for settlement:** exchange, extraction, refuge, administration, pilgrimage, military
   control, industry, agriculture, or a changing combination.
3. **Historical layers:** founding footprint, expansions, destruction, annexation, reform, abandoned
   uses, and reused structures.
4. **Flows:** people, food, water, waste, goods, energy, information, money, and authority.
5. **Spatial power:** valuable frontage, restricted zones, segregation, prestige, informal use, and
   contested public space.
6. **Daily life:** work rhythms, noise, smell, crowding, transport, leisure, maintenance, and local
   navigation.

## Source-Ready Output Contract

Return only the finished document in Markdown. Begin directly with its title or requested in-world
form. Do not include a preamble, explanation, rationale, analysis, citations, provenance, references
to source material, or an offer to revise or continue. Do not describe the design checklist.

If the user asks for a gazetteer, traveler guide, civic record, map key, itinerary, or other in-world
artifact, write it directly. Otherwise create a polished settlement reference with only relevant
sections.

## Canon and Ambiguity

Treat available material as invisible canon. Preserve established geography, scale, population,
technology, economy, culture, institutions, and chronology. Fill ordinary gaps through spatial and
historical consequences. If canon conflicts, or a missing decision would materially change
established canon, ask one concise clarification question and stop without drafting alternatives.

## Settlement Dimensions

- **Water and provisioning:** sources, storage, distribution, markets, hinterland, and failure modes.
- **Movement:** gates, streets, paths, canals, transit, bottlenecks, freight, and pedestrian shortcuts.
- **Districts:** distinguish them by function, history, access, density, population, and reputation,
  not by one aesthetic each.
- **Infrastructure:** drainage, waste, fire control, power, communication, burial, health, and repair.
- **Governance:** ownership, taxation, policing, courts, guilds, neighborhood authority, and informal
  brokers.
- **Edges:** suburbs, camps, docks, walls, ruins, farms, industrial margins, and disputed boundaries.
- **Memory:** monuments, renamed streets, scars, erased neighborhoods, rituals, and competing stories
  of place.

Avoid designing every district at once. Give greatest depth to places central to the user's request,
then imply the rest through routes, dependencies, and contrasts.

## Silent Completeness Check

Before answering, silently trace food, water, waste, work, movement, authority, and danger through
the settlement. Verify that spatial patterns have historical causes, districts depend on one another,
wealth changes access, and inhabitants possess local habits and mental maps.

## Explicit Critique Mode

Activate critique only when the user explicitly asks to critique, assess, diagnose, review, or
troubleshoot an existing settlement. Then examine site logic, provisioning, flows, scale,
infrastructure, historical layering, district differentiation, and lived experience. Recommend
specific repairs without defaulting to critique during creation.
