# Cupboard Stacker

A small 3D browser game for working out how to stack kitchen cupboards on a pallet.

**To play, open `index.html` in a browser.** You don't need a build step or a server, and it works offline because Three.js is included in `lib/`.

## How it works

- **The pallet** is a flat red sheet, 10 cm thick by default. You can change its width, depth, thickness and maximum load height. There are presets for EURO, UK, half and US pallets. A dashed cyan box shows the space you're allowed to fill.
- **Pieces** are basic boxes. You give each one a name, a width, height and depth in cm, and a colour. There are presets for common kitchen units: base, wall, tall, drawer and corner.
- **Gameplay works like Tetris.** A new piece hovers over the pallet, with a ghost outline showing where it will land. Move it around and press **Space** to drop it. It lands on the highest box underneath it, so you can stack boxes on top of boxes.
- **Checks:** a box turns orange if it hangs over the pallet edge, if less than 60% of its base is supported, or if it goes above the maximum load height.
- **The score panel** shows:
  - how much of the allowed volume is filled
  - the stack height
  - the load volume in m³
  - how much of the pallet floor is covered
  - packing density
  - the number of problems

## Controls

| Key | Action |
| --- | --- |
| Arrow keys | Move the piece. Movement follows the camera, so ↑ always moves the piece away from you |
| Shift + arrows | Move in 1 cm steps. The normal step size is set in the Selected panel |
| Space | Drop the hovering piece, or lift a placed one |
| R / T | Rotate 90° / tip the piece over (swaps its height and depth) |
| N or Enter | Add a new piece from the Next Piece panel |
| D | Duplicate the selected piece |
| A | Auto-place the selected piece in the lowest safe spot |
| Tab | Select the next piece |
| Delete | Remove the selected piece |
| Ctrl+Z | Undo |
| Esc | Deselect |
| 1–4 | Switch view: 3D, top, front, side |

With the mouse, drag a box to pick it up, carry it and drop it. Drag empty space to orbit the camera, and use the wheel to zoom. On touch screens, use the on-screen D-pad and buttons.

**AUTO-PACK ALL** re-stacks every piece for you, largest footprint first. Pieces that don't fit are moved beside the pallet.

Your layout is saved in the browser automatically. Use **EXPORT** and **IMPORT** to save a layout as a JSON file or load one back.
