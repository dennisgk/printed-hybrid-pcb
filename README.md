# Traceform

A Vite, React, TypeScript editor for 3D printed electronics carriers. The design canvas is SVG; solid generation runs locally in a Manifold WASM worker.

## Run and check

- npm install
- npm run dev
- npm test
- npm run build
- npm run lint
- npm run schema regenerates public/project.schema.json.

No application state is persisted in local storage, IndexedDB, or a server. Save JSON downloads the complete project, including component drafts and open tabs. STL generation requires a valid edge-cut boundary; the editor itself is unbounded.

## Component constraints

The component toolbar has separate constraint controls below a divider:

- D: Parallel side constraint. Select a reference side or rectangular midaxis, then a parallel target. Circular targets offer near tangent, center axis, and far tangent.
- G: Central constraint. Pick a ground rectangle/circle (including the body or pins), then the target. The target center moves to the ground center and both position coordinates remain driven.
- A: Angular constraint. Select two adjacent polygon sides. The shared vertex moves along the internal bisector line captured at creation; the outer vertices stay fixed. Angles are strictly between 0 and 180 degrees.

After selecting features, enter the value in the canvas popup and press Enter or Apply. Click an existing distance/angle annotation to edit it again. Drag labels to move them; drag dimension lines or angular arcs to reposition them. Automatic placement scores overlap with geometry, names, pins, and other dimensions. Manual placements are saved in JSON and can be reset with Auto-place annotation in Properties. Expressions support numbers, +, -, *, /, ^, parentheses, unary signs, and standard precedence. No variables, functions, or JavaScript execution are supported.

Across objects, a distance moves the second object. Within one rectangle or square pin, it controls the relevant size. Within one polygon, it moves the second edge's two vertices. Circular targets move by center and retain their editable size. The component body is fixed at 0,0 and its width/height remain manual; its features are reference-only.

Constraint creation and value edits first try the selected order, then the reversed order after an error. Both attempts enforce the same body protection, cycle, and ownership rules; arbitrary geometry edits do not reverse existing constraints.

Constraints appear in their own Elements group. Controlled properties are disabled and link to their constraint. Delete a constraint to release its properties without reverting geometry. Conflicts, duplicate drivers, cycles, nonparallel edits, and broken references reject the entire change. Accepted changes and propagation are undoable together.

Save Component applies solved geometry to all placed copies. Save JSON also retains unapplied drafts. Project instances do not have constraints.

## JSON format

New files use schema version 2. Version 1 loads with empty constraint collections and generated polygon vertex IDs. Geometry, pins, instance IDs, and trace references are retained. Version 2 stores component-local constraints, original expressions, resolved values, feature references, and stable polygon vertex IDs.

Runtime validation additionally checks ID uniqueness, reference existence, polygon-side adjacency, expression consistency, property ownership, and dependency cycles. Invalid imports leave the active project untouched.

Fit clearance per side expands component recesses and clearance-zone cuts. Pin holes use the separate hole diameter allowance; for square pins it is added to the side length. Constraints operate on nominal dimensions before these print allowances.

Landing pads match the pin shape: circles for circular pins and squares for square pins, rotated with their component. Landing diameter margin (`board.settings.landingMargin`) adds to the printed hole diameter or square side length. It accepts zero and defaults to 1 mm when loading older files. The resulting pad diameter (side length for squares) is still at least the minimum landing diameter, default trace width, and widest connected trace. Canvas, clearance validation, and STL generation share the same pad geometry, including square corners. Lined trace cuts also use a square opening at square landing centers.

**Square Pin Bottom Face** changes only square pins' underside landing pads: **Square** is the default, including when loading files without the setting; **Circular** restores the former round pads, sized around the square hole's diagonal plus landing margin. Square pin holes and hole plugs keep their square shape, and circular pins are unaffected. Lined center openings follow the chosen pad shape. JSON stores `board.settings.squarePinBottomFace` (`square` or `circular`).

Fabrication's **Plug holes** dropdown applies to all circular and square pin holes in the 3D preview and STL:

- **None** keeps the existing open holes and is the default for older JSON files.
- **Fill** leaves the holes solid, preserving component recesses and clearance-zone cuts.
- **Slightly connected** retains a core with a surrounding relief gap and four breakaway tabs near the plate underside. Tabs follow component rotation. Plug gap per side (default 0.15 mm), tab width (0.35 mm), and tab thickness (0.2 mm) are adjustable. Actual tab height is limited by the available plate material. Remove plugs before assembly; removal force and printable gaps depend on the printer, slicing, and material.

The JSON fields are `plugHoles` (`none`, `fill`, or `slightly-connected`), `plugGap`, `plugTabWidth`, and `plugTabThickness` in `board.settings`. The 2D editor and routing checks retain the finished hole geometry in every mode. Export reports a pin-specific error if the gap consumes a plug or the tabs leave no breakaway gaps.

**Trace Cut** offers **None** (existing solid ridges, also the default for older files) or **Lined**. Lined removes a centered, round-ended channel along every trace, including bends, explicit junctions, and the centers of connected pin landing pads. The channel stops flush with the underside base of the board; the plate thickness and recess floors remain intact. Outer widths, landing-pad diameters, and ridge height keep their existing settings. Trace Cut Width is in millimeters (default 1 mm) and must be smaller than every placed trace width to retain raised borders. The 2D canvas shows the channel; preview and STL use the same geometry. Hole plug settings still apply and routing remains single-layer with the existing clearance and crossing checks. JSON stores `board.settings.traceCut` (`none` or `lined`) and `board.settings.traceCutWidth`.
