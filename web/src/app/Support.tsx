import React, { useState } from 'react';
import { post } from '../shared/api';
import { Field, Modal, Msg, useAction } from './ui';

/** GET SUPPORT → plain-language report → SEND FOR SUPPORT (Q14–Q16). The owner never has to diagnose anything. */
export function SupportModal({ onClose, area }: { onClose: () => void; area?: string }) {
  const [note, setNote] = useState('');
  const [report, setReport] = useState<any>(null);
  const a = useAction();
  const create = () => a.run(async () => setReport(await post('/api/support/report', { note, area })));
  const download = () => {
    const blob = new Blob([report.body], { type: 'text/plain' }); const u = URL.createObjectURL(blob);
    const el = document.createElement('a'); el.href = u; el.download = `BrittVideo_Support_Report_${new Date().toISOString().slice(0, 10)}.txt`; el.click();
    setTimeout(() => URL.revokeObjectURL(u), 1500);
  };
  const send = async () => {
    let via = 'shared';
    try {
      if (report.supportEmail) {
        via = 'email';
        location.href = `mailto:${report.supportEmail}?subject=${encodeURIComponent('BrittVideo support: ' + report.summary.slice(0, 80))}&body=${encodeURIComponent(report.body.slice(0, 1800) + (report.body.length > 1800 ? '\n\n(Full report attached separately if needed.)' : ''))}`;
      } else if ((navigator as any).share) {
        await (navigator as any).share({ title: 'BrittVideo Support Report', text: report.body });
      } else { await navigator.clipboard.writeText(report.body); via = 'copied'; a.setOk('The report was copied. Paste it into a message to your support contact.'); }
      await post(`/api/support/report/${report.id}/sent`, { via });
      if (via !== 'copied') a.setOk('Your support message is ready to send.');
    } catch { download(); a.setOk('The report was downloaded. Attach that file to a message to your support contact.'); }
  };
  return <Modal title="Get Support" onClose={onClose}>
    {!report ? <>
      <p>You don't need to figure out what went wrong. BrittVideo gathers the technical details for you. Passwords, card data and keys are never included.</p>
      <Field label="What were you trying to do? (optional)"><textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="For example: I pressed Become a Client and nothing happened." /></Field>
      <div className="actions"><button className="btn next" onClick={create} disabled={a.busy}>{a.busy ? 'Preparing…' : 'PREPARE SUPPORT REPORT'}</button></div>
    </> : <>
      <div className={'notice ' + (/Normal/.test(report.summary) ? 'ok' : 'warn')}><b>{report.summary}</b></div>
      <details style={{ marginTop: 12 }}><summary>Show the report</summary><pre className="report">{report.body}</pre></details>
      <div className="actions">
        <button className="btn next" onClick={send}>SEND FOR SUPPORT</button>
        <button className="btn" onClick={download}>DOWNLOAD REPORT</button>
      </div>
      {!report.supportEmail && <p className="help">No support email is set up yet, so SEND FOR SUPPORT opens your device's Share menu (or copies the report).</p>}
    </>}
    <Msg error={a.error} ok={a.ok} />
  </Modal>;
}
