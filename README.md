# Cupboard Stacker

A small 3D browser game for working out how to stack kitchen cupboards on a pallet.

**To play, open `index.html` in a browser.** You don't need a build step or a server, and it works offline because Three.js is included in `lib/`.

## How it works

- **The pallet** is a flat red sheet, 10 cm thick by default. You can change its width, depth, thickness and **height limit** (how high its load may go; 200 cm by default). Each pallet has its own height limit, set under **Selected pallet**. There are presets for EURO, UK, half and US pallets. A dashed cyan box over each pallet shows the space you're allowed to fill, and follows its height limit.
- **No pallet:** untick **Use pallets** to size a load without one. Pieces stand on the floor and a dashed box around them shows the space they take up, with the size written underneath (the score panel also shows **Load size**). **AUTO-PACK ALL** then packs every piece as tightly as it can, side by side, stacked up to the max load height and nested where they fit, choosing the layout with the smallest floor area. **MAKE PALLET THIS SIZE** turns pallets back on with one pallet sized to the load.
- **Pack inside a set space:** with no pallet, tick **Pack inside a set space** and set its width, depth and height, or pick a preset (small van, long van, Luton, 20 ft container; the sizes are approximate, so edit them to match yours). The space is drawn as a solid cyan box. **AUTO-PACK ALL** fills it from the floor up (stacking and nesting where allowed), lays tall units on their backs if they can't stand under its height, and sets anything that doesn't fit beside it. Pieces outside the space are flagged, and **volume filled** is measured against the space.
- **Pack just some pieces:** select the pieces you want (Ctrl+click, or **SELECT ALL THIS COLOUR** to pick every piece of one colour), then press **AUTO** or **A**. With no pallet, they're packed together beside the rest and the status bar shows the space they need.
- **More pallets:** use **+ PALLET →** or **+ PALLET ↓** to add a pallet beside or in front of the others, with an optional gap. Click a pallet to edit its size or position, or drag it with the mouse; the pieces on it move with it.
- **Cabinets are hollow carcasses.** Each one is built from boards: two sides, a back and a base, plus a lid you can switch on or off. The front is open. You set its width, height, depth and the board thickness (1.8 cm, i.e. 18 mm, by default). Because the middle is empty, you can put one unit inside another:
  - **Drop it in:** a unit dropped over an open-top cabinet falls inside and lands on the base board.
  - **Slide it in:** a unit pushed with the arrow keys against a cabinet's open front steps up onto the base board and slides inside, provided it fits under the lid.
  - **Lay it on its back:** **T** lays a cabinet on its back so the open side faces up, ready to be filled (press T again to lay it on its side, and again to stand it up).
- **Other shapes:** **solid box**, **cylinder** (set by diameter) and **L-corner** (an L-shaped corner unit with a set arm depth). Presets cover base, wall, tall and drawer cabinets (base units default to no lid; wall and tall units have one), plus a carton, an L-corner, a drum and a tube.
- **Best orientation:** with **ORIENT: ANY** (next to AUTO-PACK ALL), auto-pack may stand a box or cabinet upright, lay it on its back or lay it on its side, and turn it in plan. It packs the load several ways (keeping units upright, laying them flat to stay low, turning them to fill gaps) and keeps whichever fits the most units, then is lowest, then turns the fewest over. The status bar says how many were turned. Switch to **ORIENT: UPRIGHT** to keep every unit standing (they are still turned in plan).
- **Packed around:** tick **Packed around (+5 cm each side)** to add 5 cm of packaging (bubble wrap or similar) on every side of a unit, top and bottom included. The unit is drawn inside a see-through shell, its packed size is what's stacked and packed, and a wrapped cabinet counts as closed, so nothing nests inside it. The W/H/D fields keep showing the unit's own size. Select several units to wrap or unwrap them all at once.
- **Stacking on/off:** the **STACKING: ON / OFF** button next to AUTO-PACK ALL switches stacking for the whole load. When it's off, AUTO-PACK ALL lays every unit side by side in a single layer (units can still go *inside* open cabinets), and anything you stack by hand is flagged.
- **Stackable or not, per unit:** every unit also has its own **Stackable** checkbox, ticked by default. Untick it for units that mustn't carry a load; their label then reads NO STACK. Anything placed on top of one turns orange and counts as an issue, and auto-place / auto-pack never stack onto it. Putting a unit *inside* a non-stackable open cabinet (on its base board) is still allowed. Select several units first to change them all at once.
- **Gameplay works like Tetris.** A new piece hovers over the pallet, with a ghost outline showing where it will land. Move it around and press **Space** to drop it. It falls until one of its boards meets one below, so it can stack on top of another unit or land inside an open one.
- **Checks:** a piece turns orange if it hangs over the pallet edge, if nothing is underneath its centre (so it would tip), if it sits on top of a non-stackable unit, or if it goes above the maximum load height. A cabinet resting on the edges of an open one below counts as supported.
- **The score panel** shows:
  - how much of the allowed volume is filled
  - the stack height
  - the load volume in m³ (the space the load really takes up, so units nested inside others, fully or partly, aren't counted twice)
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
| R / T | Rotate 90° / turn a cabinet or box: upright → on its back → on its side → upright |
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
