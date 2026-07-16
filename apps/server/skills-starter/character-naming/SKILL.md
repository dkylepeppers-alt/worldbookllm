---
name: character-naming
description: Create distinctive character names and coherent naming systems grounded in language, culture, region, class, family, generation, and identity. Use for generation or explicit critique.
license: MIT
metadata:
  author: "jwynia; adapted by worldbookllm"
  version: "2.0"
  type: generator
  mode: generative+explicit-critique
  domain: character
---

# Character Naming

Create names that feel selected by people inside a culture rather than sampled from a generic list.

## Creation Mode

Default to producing the requested names, cast list, naming convention, genealogy, titles, or
onomastic reference. Use canon and cultural context to constrain invention. Do not discuss why the
user's existing names are weak unless critique is explicitly requested.

For each naming culture, silently establish:

1. A sound inventory and a few recurring phonological patterns.
2. Common name shapes, syllable counts, stress, endings, and allowed clusters.
3. Sources of names: ancestors, places, virtues, occupations, gods, events, birth order, or poetic
   compounds.
4. Social structure: family names, patronymics, matronymics, clan names, regnal names, teknonyms,
   epithets, ranks, and intimate forms.
5. Variation by region, class, faith, generation, migration, and language contact.
6. The practical distinction between legal, public, family, ceremonial, and chosen identity.

## Source-Ready Output Contract

Return only the finished document in Markdown. Begin directly with the requested list, reference
entry, genealogy, register, or in-world record. Do not include a preamble, explanation, rationale,
analysis, citations, provenance, references to source material, or an offer to generate more. Do not
report your selection process.

Give meanings or pronunciation notes only when they belong in the requested document or materially
help its use. Do not append generic naming advice.

## Canon and Ambiguity

Treat available material as invisible canon. Preserve established names, spellings, honorifics,
linguistic relationships, and cultural boundaries. Fill ordinary gaps consistently. If canon
conflicts, or a missing decision would materially change established canon, ask one concise
clarification question and stop without producing candidate sets.

## Naming Quality

- Prefer a recognizable family resemblance without making every name rhyme.
- Avoid accidental cast collisions in initials, length, stress, visual silhouette, or nickname.
- Let historical layers coexist: inherited native forms, borrowed prestige names, religious names,
  colonial spellings, reforms, and modern revivals.
- Make names reflect social choices. Parents may honor kin, signal aspiration, conceal origin,
  preserve resistance, or follow fashion.
- Use external entropy when invention starts clustering around familiar model defaults: alter the
  phoneme seed, semantic source, historical layer, or morphological rule before generating again.
- Avoid encoding every personality trait in a name. Most names predate the person's story.

## Silent Completeness Check

Before answering, silently test names aloud and on the page, check cast distinctness, verify that
forms obey the culture's rules, and ensure exceptions have social or historical reasons. Include
enough pattern evidence for the user to extend the system later when a naming reference is requested.

## Explicit Critique Mode

Activate critique only when the user explicitly asks to critique, assess, diagnose, review, or
troubleshoot existing names. Then examine collisions, cultural coherence, phonological patterns,
social plausibility, unintended associations, and model-default clustering. Offer specific
replacements or rule changes only within that explicit review.
