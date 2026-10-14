---
type: continuity-state
story: the-salt-ledger
current-chapter: 1
character-state:
  - character: wren-adair
    location: customs-house
    physical-state: unharmed
    emotional-state: alarmed-and-determined
  - character: ilse-varga
    location: customs-house
    physical-state: unharmed
    emotional-state: resigned-and-wary
object-state:
  - artifact: margery-lane-docket
    owner: wren-adair
    location: customs-house
    status: active
knowledge-state:
  - character: wren-adair
    knows: The Margery Lane has paid salt tithe every quarter for 19 years
    learned-in: chapter-01
    do-not-reveal: false
  - character: wren-adair
    knows: Ilse Varga's heron seal is on every Margery Lane entry
    learned-in: chapter-01
    do-not-reveal: false
  - character: wren-adair
    knows: She herself copied a Margery Lane docket two years ago
    learned-in: chapter-01
    do-not-reveal: false
  - character: wren-adair
    knows: The autumn quarter docket lists berth nine and bears the message "Tell O. the lamp is lit"
    learned-in: chapter-01
    do-not-reveal: false
  - character: wren-adair
    knows: A ship is coming in on tomorrow night's tide
    learned-in: chapter-01
    do-not-reveal: false
  - character: ilse-varga
    knows: Wren has discovered the Margery Lane anomaly
    learned-in: chapter-01
    do-not-reveal: false
---

# Continuity State

## Current Story State

Track facts that must carry forward between chapters. The CLI reads the
`character-state`, `object-state`, and `knowledge-state` lists in the
frontmatter above; the tables below are optional notes it does not read.

## Character State

| Character | Location | Physical State | Emotional State |
|-----------|----------|----------------|-----------------|
| wren-adair | customs-house | unharmed | alarmed and determined |
| ilse-varga | customs-house | unharmed | resigned and wary |

## Object State

| Artifact | Owner | Location | Status |
|----------|-------|----------|--------|
| margery-lane-docket | wren-adair | customs-house-cellar | discovered |

## Knowledge State

| Character | Knows | Learned In |
|-----------|-------|------------|
| wren-adair | The Margery Lane has paid salt tithe every quarter for 19 years | chapter-01 |
| wren-adair | Ilse Varga's heron seal is on every Margery Lane entry | chapter-01 |
| wren-adair | She herself copied a Margery Lane docket two years ago | chapter-01 |
| wren-adair | The autumn quarter docket lists berth nine and bears the message "Tell O. the lamp is lit" | chapter-01 |
| wren-adair | A ship is coming in on tomorrow night's tide | chapter-01 |
| ilse-varga | Wren has discovered the Margery Lane anomaly | chapter-01 |
