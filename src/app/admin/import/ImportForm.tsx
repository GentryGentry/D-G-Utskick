"use client";
import { useActionState } from "react";
import { commitImportAction, previewImportAction } from "../actions";

export default function ImportForm({ tenant }: { tenant: string }) {
  const [preview, previewAction, previewing] = useActionState(previewImportAction, undefined);
  const [result, commitAction, committing] = useActionState(commitImportAction, undefined);

  if (result && "done" in result) return (
    <p className="notice" role="status">Klart. {result.inserted} nya adresser lades till. {result.existing} fanns redan och lämnades orörda. {result.suppressed} hoppades över eftersom de tidigare avregistrerats eller tagits bort.</p>
  );
  return (
    <>
      <form action={previewAction}>
        <input type="hidden" name="tenant" value={tenant} />
        <label htmlFor="file">CSV-fil</label>
        <input id="file" name="file" type="file" accept=".csv,text/csv,text/plain" required />
        <button type="submit" disabled={previewing}>{previewing ? "Läser…" : "Förhandsgranska"}</button>
      </form>
      {preview && "error" in preview && <p className="error" role="alert">{preview.error}</p>}
      {preview && "ok" in preview && (
        <>
          <h2>Förhandsgranskning</h2>
          <table><tbody>
            <tr><td>Nya adresser som läggs till</td><td><strong>{preview.counts.fresh}</strong></td></tr>
            <tr><td>Finns redan (lämnas orörda, taggar läggs till)</td><td>{preview.counts.existing}</td></tr>
            <tr><td>Hoppas över: tidigare avregistrerade eller borttagna</td><td>{preview.counts.suppressed}</td></tr>
            <tr><td>Dubbletter i filen (slås ihop)</td><td>{preview.counts.duplicatesInFile}</td></tr>
            <tr><td>Ogiltiga rader (hoppas över)</td><td>{preview.counts.invalid}{preview.invalidSample.length > 0 && <span className="muted"> (rad {preview.invalidSample.join(", ")}{preview.counts.invalid > preview.invalidSample.length ? " …" : ""})</span>}</td></tr>
          </tbody></table>
          <form action={commitAction}>
            <input type="hidden" name="tenant" value={preview.tenant} />
            <input type="hidden" name="rows" value={preview.rowsJson} />
            <button type="submit" disabled={committing || preview.counts.fresh + preview.counts.existing === 0}>{committing ? "Importerar…" : `Importera ${preview.counts.fresh} adresser`}</button>
            {result && "error" in result && <p className="error" role="alert">{result.error}</p>}
          </form>
        </>
      )}
    </>
  );
}
