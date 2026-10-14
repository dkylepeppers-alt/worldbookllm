---
title: Story variables
---
// Ink for the whole story: VAR, CONST, and LIST declarations, functions, and shared knots.
// How much Varga lets slip that she is relieved someone finally found the truth; 0 (guarded mentor) to 3 (openly confessional), rises when Wren asks precise questions or mirrors Varga's own methods, falls if Wren accuses rather than inquires
VAR varga_relief = 0
// How much physical evidence Wren has compiled of the fraud; 0 (suspicion only) to 4 (copied dockets, handwriting sample, berth nine lamp, and Cask's message), each increment unlocks new conversational leverage and closing options
VAR salt_ledger_gap = 0
// Whether the Weigher on the quay has noticed Wren's irregular movements; 0 (unobserved) to 2 (directly questioned), affects whether berth nine can be visited freely and whether Varga hears of Wren's inquiries before they speak
VAR weigher_attention = 0
// What Wren has confronted about her own memory of the Margery Lane; 0 (father's story intact) to 2 (visited plaque, recognized Cask's name from childhood, understood her own handwriting helped bury eleven men), changes how she frames the moral stakes
VAR harrowmere_plaque = 0
// Whether Wren understands what 'the lamp is lit' signals; 0 (unknown phrase) to 2 (witnessed berth nine lamp at tide, decoded the arrangement's living mechanism), determines if she can intercept or expose the incoming ship
VAR tidewarden_lamp = 0
// How Wren has positioned herself among the nineteen years of clerks; 0 (determined to be different) to 2 (recognized her own hand among them, accepted complicity), shifts tone from righteous discovery to mournful understanding
VAR clerks_who_copied = 0
// Whether Wren is currently carrying the physical evidence (copied sheets and docket) on her person
VAR has_evidence = false
