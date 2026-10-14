# Cupboard Stacker

A small 3D browser game for working out how to stack kitchen cupboards on a pallet.

**To play, open `index.html` in a browser.** You don't need a build step or a server, and it works offline because Three.js is included in `lib/`.

## How it works

- **The pallet** is a flat red sheet, 10 cm thick by default. You can change its width, depth, thickness and maximum load height. There are presets for EURO, UK, half and US pallets. A dashed cyan box shows the space you're allowed to fill.
- **No pallet:** untick **Use pallets** to size a load without one. Pieces stand on the floor and a dashed box around them shows the space they take up, with the size written underneath (the score panel also shows **Load size**). **AUTO-PACK ALL** then packs every piece as tightly as it can, side by side, stacked up to the max load height and nested where they fit, choosing the layout with the smallest floor area. **MAKE PALLET THIS SIZE** turns pallets back on with one pallet sized to the load.
- **Pack just some pieces:** select the pieces you want (Ctrl+click, or **SELECT ALL THIS COLOUR** to pick every piece of one colour), then press **AUTO** or **A**. With no pallet, they're packed together beside the rest and the status bar shows the space they need.
- **More pallets:** use **+ PALLET →** or **+ PALLET ↓** to add a pallet beside or in front of the others, with an optional gap. Click a pallet to edit its size or position, or drag it with the mouse; the pieces on it move with it.
- **Cabinets are hollow carcasses.** Each one is built from boards: two sides, a back and a base, plus a lid you can switch on or off. The front is open. You set its width, height, depth and the board thickness (1.8 cm, i.e. 18 mm, by default). Because the middle is empty, you can put one unit inside another:
  - **Drop it in:** a unit dropped over an open-top cabinet falls inside and lands on the base board.
  - **Slide it in:** a unit pushed with the arrow keys against a cabinet's open front steps up onto the base board and slides inside, provided it fits under the lid.
  - **Lay it on its back:** **T** lays a cabinet on its back so the open side faces up, ready to be filled.
- **Other shapes:** **solid box**, **cylinder** (set by diameter) and **L-corner** (an L-shaped corner unit with a set arm depth). Presets cover base, wall, tall and drawer cabinets (base units default to no lid; wall and tall units have one), plus a carton, an L-corner, a drum and a tube.
- **Stackable or not:** every unit has a **Stackable** checkbox, ticked by default. Untick it for units that mustn't carry a load; their label then reads NO STACK. Anything placed on top of one turns orange and counts as an issue, and auto-place / auto-pack never stack onto it. Putting a unit *inside* a non-stackable open cabinet (on its base board) is still allowed. Select several units first to change them all at once.
- **Gameplay works like Tetris.** A new piece hovers over the pallet, with a ghost outline showing where it will land. Move it around and press **Space** to drop it. It falls until one of its boards meets one below, so it can stack on top of another unit or land inside an open one.
- **Checks:** a piece turns orange if it hangs over the pallet edge, if nothing is underneath its centre (so it would tip), if it sits on top of a non-stackable unit, or if it goes above the maximum load height. A cabinet resting on the edges of an open one below counts as supported.
- **The score panel** shows:
  - how much of the allowed volume is filled
  - the stack height
  - the load volume in m³
  - how much of the pallet floor is covered
  - packing density
  - how many units are nested completely inside another (these add no load volume)
  - the number of problems

## Controls

| Key | Action |
| --- | --- |
| Arrow keys | Move the piece. Movement follows the camera, so ↑ always moves the piece away from you |
| Shift + arrows | Move in 1 cm steps. The normal step size is set in the Selected panel |
| Space | Drop the hovering piece, or lift a placed one |
| R / T | Rotate 90° / lay a cabinet or box on its back (T again stands it up) |
| Ctrl+click | Add a piece to the selection, or remove it. Moving, rotating, dropping and editing then apply to every selected piece |
| Ctrl+A | Select every piece |
| Ctrl+C / Ctrl+X / Ctrl+V | Copy / cut / paste the selected pieces. Pasted pieces hover in the same spot and keep their arrangement |
| N or Enter | Add a new piece from the Next Piece panel |
| D | Duplicate the selected piece |
| A | Auto-place the selected piece in the lowest safe spot |
| Tab | Select the next piece |
| Delete | Remove the selected piece |
| Ctrl+Z | Undo |
| Esc | Deselect |
| 1–4 | Switch view: 3D, plan, front, side. Plan, front and side are flat, true-scale drawings (no perspective) |

With the mouse, drag a box to pick up the selection, carry it and drop it. Drag a pallet to move it with its load. Drag empty space to orbit the camera (or pan, in the flat views), and use the wheel to zoom. On touch screens, use the on-screen D-pad and buttons.

**AUTO-PACK ALL** re-stacks every piece for you, largest first, always taking the lowest safe spot. That includes spots inside open cabinets, so it nests units where they fit. Pieces that don't fit are moved beside the pallet.

Your layout is saved in the browser automatically. Use **EXPORT** and **IMPORT** to save a layout as a JSON file or load one back.
