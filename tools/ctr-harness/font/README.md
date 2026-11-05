# Stand-in system font

Megamix draws its text with the 3DS system font, which is not part of the game. `build/ctr/standin.bcfnt`
is a free replacement that `make-font.py` draws from Inter SemiBold (SIL Open Font License, `OFL.txt`)
and, for a few symbols, DejaVu Sans Bold (Bitstream Vera license, `LICENSE-DejaVu.txt`). It uses the
system font's layout (24x30 cells, 128x128 A4 sheets) and draws the button symbols (A, B, X, Y, L,
R, +Control Pad) as simple shapes. The harness loads it into the shared font block at start.

`get-font.sh` (run by build-local.sh and build-web.sh) downloads Inter 4.0 and DejaVu 2.37 from their
GitHub releases into build/fonts (checked by SHA-256) and builds it; delete the .bcfnt to rebuild.
