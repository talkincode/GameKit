import { useEffect, useMemo, useState } from "react";
import { loadAssetBytes, loadLibrary } from "../lib/assets/catalog";
import { editorTileset, type EditorTileset } from "../lib/assets/tileset";
import { MAP_PRESETS, TILE_SIZES, cleanMapName, isMapSlug, nextMapSlug } from "../lib/map/model";
import { mapDocumentPath } from "../lib/map/document";
import { useStudio } from "../studio/store";
import { text } from "./text";
import "./map-editor.css";

type LibrarySheet = { id: string; title: string; fit: EditorTileset; packId: string; path: string };

/** Picks a name and a size. Nothing is written until the child saves inside the editor. */
export function MapNewDialog() {
  const studio = useStudio();
  const paths = useMemo(() => new Set(studio.project?.files.map((file) => file.path) ?? []), [studio.project]);
  const slugs = useMemo(
    () =>
      [...paths]
        .map((path) => {
          const match = /^maps\/([a-z0-9]+(?:-[a-z0-9]+)*)\.map\.json$/.exec(path);
          return match?.[1] ?? "";
        })
        .filter(Boolean),
    [paths],
  );
  const [slug, setSlug] = useState(() => nextMapSlug(slugs, "level-1") ?? "level-1");
  const [name, setName] = useState("第一关");
  const [preset, setPreset] = useState<(typeof MAP_PRESETS)[number]["id"]>("small");
  const [tile, setTile] = useState<(typeof TILE_SIZES)[number]>(16);
  const [sheets, setSheets] = useState<LibrarySheet[]>([]);
  const [sheetId, setSheetId] = useState("starter");
  const [sheetProblem, setSheetProblem] = useState("");
  useEffect(() => {
    let cancel = false;
    void loadLibrary()
      .then((packs) => {
        if (cancel) return;
        setSheets(
          packs.flatMap((pack) =>
            pack.assets.flatMap((asset) => {
              const fit = editorTileset(asset);
              return fit ? [{ id: asset.id, title: asset.title, fit, packId: pack.id, path: asset.path }] : [];
            }),
          ),
        );
      })
      .catch(() => {
        if (!cancel) setSheets([]);
      });
    return () => {
      cancel = true;
    };
  }, []);
  const chosenSheet = sheets.find((sheet) => sheet.id === sheetId && sheet.fit.tileWidth === tile) ?? null;
  const cleanSlug = slug.trim().toLowerCase();
  const slugOk = isMapSlug(cleanSlug);
  const nameOk = !!cleanMapName(name);
  const document = slugOk ? mapDocumentPath(cleanSlug) : null;
  const taken = !!document && paths.has(document);
  const suggestion = taken ? nextMapSlug(slugs, cleanSlug) : null;
  const size = MAP_PRESETS.find((item) => item.id === preset) ?? MAP_PRESETS[0];

  const start = () => {
    if (!slugOk || !nameOk || taken) return;
    const base = {
      slug: cleanSlug,
      name: cleanMapName(name) ?? name,
      columns: size.columns,
      rows: size.rows,
      tileWidth: tile,
      tileHeight: tile,
    };
    setSheetProblem("");
    if (!chosenSheet) {
      studio.startMapNew(base);
      return;
    }
    const sheet = chosenSheet;
    void loadAssetBytes(sheet.packId, sheet.path).then((bytes) => {
      const opened =
        !!bytes &&
        studio.startMapNew({
          ...base,
          tilesetColumns: sheet.fit.columns,
          tilesetRows: sheet.fit.rows,
          tilesetPng: bytes,
          tileNames: sheet.fit.names,
        });
      if (!opened) setSheetProblem(text.map.tilesetMissing);
    });
  };

  return (
    <div className="modal-back">
      <div className="modal map-new" role="dialog" aria-modal="true" aria-labelledby="map-new-title" data-testid="map-new-dialog">
        <h2 id="map-new-title">{text.map.newTitle}</h2>
        <p>{text.map.newCopy}</p>
        <label className="map-field">
          <span>{text.map.name}</span>
          <input value={name} aria-invalid={!nameOk} data-testid="map-name" onChange={(event) => setName(event.target.value)} />
          <small>{text.map.nameHint}</small>
          {!nameOk ? <small className="map-problem">{text.map.nameBad}</small> : null}
        </label>
        <label className="map-field">
          <span>{text.map.slug}</span>
          <input value={slug} aria-invalid={!slugOk || taken} data-testid="map-slug" onChange={(event) => setSlug(event.target.value)} />
          <small>{text.map.slugHint}</small>
          {!slugOk ? <small className="map-problem">{text.map.slugBad}</small> : null}
          {taken ? (
            <small className="map-problem">
              {text.map.taken(cleanSlug)}{" "}
              {suggestion ? (
                <button type="button" className="map-link" onClick={() => setSlug(suggestion)}>
                  {text.map.useSlug(suggestion)}
                </button>
              ) : null}
            </small>
          ) : null}
        </label>
        <div className="map-mode" role="group" aria-label={text.map.size}>
          {MAP_PRESETS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={preset === item.id ? "on" : ""}
              aria-pressed={preset === item.id}
              data-testid={`map-size-${item.id}`}
              onClick={() => setPreset(item.id)}
            >
              {text.map.sizes[item.id]}
            </button>
          ))}
        </div>
        <div className="map-mode" role="group" aria-label={text.map.tile}>
          {TILE_SIZES.map((px) => (
            <button
              key={px}
              type="button"
              className={tile === px ? "on" : ""}
              aria-pressed={tile === px}
              data-testid={`map-tile-size-${px}`}
              onClick={() => setTile(px)}
            >
              {text.map.tileValue(px)}
            </button>
          ))}
        </div>
        <div className="map-mode" role="group" aria-label={text.map.tileset}>
          <button
            type="button"
            className={chosenSheet ? "" : "on"}
            aria-pressed={!chosenSheet}
            data-testid="map-tileset-starter"
            onClick={() => {
              setSheetId("starter");
              setSheetProblem("");
            }}
          >
            {text.map.starterTiles}
          </button>
          {sheets
            .filter((sheet) => sheet.fit.tileWidth === tile)
            .map((sheet) => (
              <button
                key={sheet.id}
                type="button"
                className={chosenSheet?.id === sheet.id ? "on" : ""}
                aria-pressed={chosenSheet?.id === sheet.id}
                data-testid={`map-tileset-${sheet.id}`}
                onClick={() => {
                  setSheetId(sheet.id);
                  setSheetProblem("");
                }}
              >
                {sheet.title}
              </button>
            ))}
        </div>
        {sheetProblem ? <p className="map-problem">{sheetProblem}</p> : null}
        <div className="modal-actions">
          <button type="button" onClick={() => studio.setMapNewOpen(false)}>
            {text.map.cancel}
          </button>
          <button type="button" className="run" data-testid="map-start" disabled={!slugOk || !nameOk || taken} onClick={start}>
            {text.map.start}
          </button>
        </div>
      </div>
    </div>
  );
}
