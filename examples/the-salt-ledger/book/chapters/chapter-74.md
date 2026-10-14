---
title: "The Clerk's Testimony"
discover-ink: "a54a8e9155beda03"
discover-parent: "d255c1582f409f96"
number: 74
status: draft
mode: discovered
discover: "written"
discover-from: "chapter-63"
---

## Beat

Wren writes Maren's testimony in real time, her clerk's habit transforming grief into document; the finished sheet becomes a new kind of evidence that binds them, and Wren must decide what form this record should take.

## Choices

- **Fold the sheet into her coat and walk into the fog** (a new beat): hoard — Wren keeps both documents, the weight of evidence literal against her ribs and the risk of discovery sharpened by what she has now written about the living
- **Hand the sheet to Maren and keep the quarters** (a new beat): transfer — Wren gives Maren her own words in a clerk's hand, making the Tidewarden responsible for their meaning and leaving herself with only the original seventy-six quarters
- **Copy the testimony onto the docket blank** (a new beat): subvert — Wren writes Maren's testimony onto the stolen docket blank, turning the form of harbor tax into witness statement and creating a document that belongs in the archive it subverts

## Chapter Text
Wren reached into her coat and found the spare sheet she kept folded against the lining, the habit of a clerk who never knew when a blotter would fail or a margin would run out. The paper was thin, Customs House stock, watermarked with a heron she could only feel by running her thumbnail across it. She found her pencil in the same pocket, the nib worn to a slope that matched her sevens.

"Say it again," she said. "Slowly."

Maren looked at the pencil, then at Wren's hands, already moving to smooth the sheet against her knee. Something shifted in her pale eyes—not surprise, but recognition, the way a sailor recognizes a particular current by the way it moves the hull.

"I thought it was one lamp," Maren said, and Wren wrote it, the letters cramped and careful, the same hand that had copied seventy-six quarters of a lie. "One boat. One tide."

The pencil scratched against the thin paper, louder than the tide. Wren did not look up. She wrote the way she had been taught: left margin straight, letters uniform, each line level as a spirit-level. The clerk's habit took her, the same trance that had carried her through three years of dockets and manifests, and she felt the familiar narrowing of attention, the world reducing to the space between the nib and the line.

"Nineteen years," Maren continued, her voice slower now, shaped by the pauses where Wren's pencil needed to catch up. "Do you know how many times I've filled that lamp?"

Wren wrote the number blank, a small square of graphite waiting for a figure she did not yet know. She wrote _filled that lamp_ and felt the strangeness of it, a verb she had never used in a ledger, an object that appeared in no inventory she had copied.

"I thought I was keeping a promise."

_Was keeping_. The tense mattered. Wren underlined it without meaning to, her pencil pressing harder, the graphite shining in the lamplight. The promise Maren named was not the same promise Varga had kept, not the balance of a harbor account, not the heron seal repeated like a heartbeat. It was older, rawer, something passed hand to hand without the mediation of wax and ring.

Maren's voice continued, finding its own rhythm, no longer waiting for Wren's pencil but moving at the pace of memory. She spoke of Emil, of the knot that slipped in a hurry, of her mother's hands giving her the lamp with the words still wet with grief. Wren wrote it all, the names and the dates and the phrases that would have meant nothing in a docket—_the sea does not forgive_, _slipped in a hurry_, _the twelfth man they did not carve_. Her hand cramped. She shifted the pencil to a new grip and kept writing, the sheet filling, the testimony becoming physical, becoming real in a way that speech alone could not make it.

The fog moved around them, indifferent. The lamp burned. The boat knocked against its fenders with a rhythm that seemed to match the scratch of the pencil, two small sounds carrying on the dark water.

When Maren fell silent, Wren wrote the last word—_safe passage_—and looked up. The sheet was full, her handwriting crawling across it in lines as straight as she could make them on her knee, the margins ragged where the quay stone pressed up. She had written Maren's testimony the way she had written the Margery Lane entries: carefully, completely, believing that the reason was written down if you were willing to look.

But this was different. This was not a docket copied into the Salt Ledger, not a ship's name entered under a seal she did not question. This was a woman's grief translated into a clerk's hand, a private promise made public by the act of inscription. Wren held the sheet in both hands and felt its weight, lighter than the roll of copied quarters but heavier in a way she could not yet name.

She had made Maren's words into a document. The sheet connected them—clerk and keeper, copyist and witness—but the connection needed a shape. She could fold it into her coat beside the seventy-six quarters, carrying both records into the fog, the weight of evidence doubled and the risk of discovery sharpened by the fact that she had now written something that named the living. She could hand it to Maren and keep only the copied quarters, dividing the truth between them so that neither held the whole of it, making two custodians of a single story. Or she could reach for the docket blank she had kept from the autumn quarter, the one with _Margery Lane_ written across the top in a weigher's careful capitals, and write Maren's testimony in the spaces between the printed lines, letting the form of harbor tax contain its own contradiction.

The lamp burned steady. The tide whispered. Wren held the filled sheet and waited for her own hand to decide what it had made.

* [Fold the sheet into her coat and walk into the fog]
    ~ salt_ledger_gap += 1
    ~ has_evidence = true
    -> chapter_87
* [Hand the sheet to Maren and keep the quarters]
    ~ tidewarden_lamp += 1
    -> chapter_88
* [Copy the testimony onto the docket blank]
    ~ clerks_who_copied += 1
    ~ varga_relief += 1
    -> chapter_89
