'use strict';

const PDFDocument = require('pdfkit');
const path = require('node:path');
const { classification, riskBand, coordinates, confidence, recordId, hash } = require('./snapshot');

const INK = '#19312c';
const MUTED = '#51665f';
const LIGHT = '#edf3ef';
const MARGIN = 42;
const FONTS = {
  Helvetica: path.join(__dirname, 'assets', 'fonts', 'DejaVuSans.ttf'),
  'Helvetica-Bold': path.join(__dirname, 'assets', 'fonts', 'DejaVuSans-Bold.ttf'),
  Courier: path.join(__dirname, 'assets', 'fonts', 'DejaVuSansMono.ttf')
};

// No single bundled font covers every writing system. Escape non-ASCII text
// visibly instead of losing source characters; the CSV and snapshot retain UTF-8.
function printable(value) {
  return String(value ?? 'Unknown').replace(/[\u2010-\u2015]/g, '-').replace(/\u00b7/g, ' / ')
    .replace(/[^\x20-\x7e\n\r\t]/g, character => '\\u' + character.charCodeAt(0).toString(16).padStart(4, '0'));
}

function createPdf(content, contentHash) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4', margin: MARGIN, bufferPages: true, autoFirstPage: false, font: FONTS.Helvetica,
      info: { Title: `TerraVigil report ${content.reportNumber} - ${content.siteName}`, Author: 'TerraVigil',
        Subject: 'Immutable mission evidence snapshot', CreationDate: new Date(content.generatedAt) }
    });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    const width = 595.28 - 2 * MARGIN;
    const bottom = 788;
    const font = (name = 'Helvetica', size = 10, color = INK) => doc.font(FONTS[name]).fontSize(size).fillColor(color);
    doc.on('pageAdded', () => {
      doc.rect(0, 0, doc.page.width, 67).fill(INK);
      font('Helvetica-Bold', 16, '#ffffff');
      doc.text('TERRAVIGIL', MARGIN, 20, { lineBreak: false });
      font('Helvetica', 8, '#d5e3dc');
      doc.text(`MISSION EVIDENCE REPORT  /  EDITION ${content.reportNumber}`, MARGIN, 43, { lineBreak: false });
      doc.y = 87;
      doc.x = MARGIN;
      font();
    });
    const ensure = height => { if (doc.y + height > bottom) doc.addPage(); };
    const heading = (text, space = 0) => {
      ensure(50 + space); doc.y += space;
      font('Helvetica-Bold', 15); doc.text(printable(text), MARGIN, doc.y, { width }); doc.moveDown(0.55);
    };
    const paragraph = (text, size = 9.2, color = MUTED) => {
      font('Helvetica', size, color);
      doc.text(printable(text), MARGIN, doc.y, { width, lineGap: 3 }); doc.moveDown(0.6);
    };
    const table = (headers, rows, widths) => {
      const sizes = widths || [width * 0.64, width * 0.36];
      function draw(values, header = false) {
        font(header ? 'Helvetica-Bold' : 'Helvetica', header ? 8.6 : 8.3);
        const clean = values.map(printable);
        const height = Math.max(22, ...clean.map((value, index) => doc.heightOfString(value, { width: sizes[index] - 14, lineGap: 2 }) + 12));
        if (doc.y + height > bottom) {
          doc.addPage();
          if (!header && headers) draw(headers, true);
        }
        const y = doc.y;
        doc.rect(MARGIN, y, width, height).fill(header ? INK : LIGHT);
        let x = MARGIN;
        values.forEach((value, index) => {
          font(header ? 'Helvetica-Bold' : 'Helvetica', header ? 8.6 : 8.3, header ? '#ffffff' : INK);
          doc.text(clean[index], x + 7, y + 6, { width: sizes[index] - 14, lineGap: 2 });
          x += sizes[index];
        });
        doc.y = y + height;
        doc.strokeColor('#ffffff').lineWidth(2).moveTo(MARGIN, doc.y).lineTo(MARGIN + width, doc.y).stroke();
      }
      if (headers) draw(headers, true);
      rows.forEach(row => draw(row));
      doc.y += 12;
    };

    try {
      doc.addPage();
      heading(content.siteName);
      paragraph(`Mission: ${content.sessionId}\nGenerated: ${content.generatedAt}\nReport ID: ${content.id}`, 9);
      if (content.testMode) {
        table(null, [['FIREBASE IMAGE TEST', 'Synthetic images and labels with recorded telemetry. No detector inference or new flight.']], [width * 0.43, width * 0.57]);
      }
      if (content.synthetic) {
        table(null, [['SYNTHETIC PRACTICE DATA', 'Includes fictional records. No real survey or model performance is established.']], [width * 0.43, width * 0.57]);
      }
      paragraph(`Project hardware: ${content.hardware?.edgeComputer ?? 'Not recorded'} / ${content.hardware?.aircraft ?? 'Not recorded'} / ${content.hardware?.flightController ?? 'Not recorded'}. Hardware names describe the team configuration, not verified device health.`, 8.8);
      heading('Frozen mission summary');
      table(['Measure', 'Stored value'], [
        ['Confirmed records (stored classification)', content.summary.confirmedMinesCount],
        ['High / medium / low risk - confirmed only', `${content.summary.highRiskCount} / ${content.summary.mediumRiskCount} / ${content.summary.lowRiskCount}`],
        ['Unconfirmed visual observations', content.summary.unconfirmedVisualCount],
        ['Unresolved metal observations', content.summary.unresolvedMetalCount],
        ['Unknown classification / confirmed risk unknown', `${content.recordCounts.unknownClassification} / ${content.recordCounts.confirmedRiskUnknown}`],
        ['Detection / observation / telemetry source rows', `${content.snapshot.detections.length} / ${content.snapshot.observations.length} / ${content.snapshot.telemetry.length}`],
        ['Firebase events / mapped', `${content.recordCounts.firebaseEvents} / ${content.recordCounts.firebaseMatched}`],
        ['Waiting for GPS / invalid / removed', `${content.recordCounts.firebasePending} / ${content.recordCounts.firebaseInvalid} / ${content.recordCounts.firebaseRemoved}`],
        ['Image inference runs / model predictions', `${content.recordCounts.imageInferenceRuns} / ${content.recordCounts.imagePredictions}`],
        ['Visual / dual-sensor swept area (m2)', `${content.summary.visualSweptAreaM2 ?? 'Unknown'} / ${content.summary.dualSweptAreaM2 ?? 'Unknown'}`],
        ['Stored risk formula version', content.formulaVersion],
        ['Report generation', content.generationMode === 'rag' ? 'Factual snapshot + RAG narrative' : 'Factual snapshot; no AI narrative requested']
      ]);
      heading('Use and interpretation');
      paragraph(content.limitations[0], 9.2);
      paragraph('The following pages retain the evidence register, complete source records and integrity references. The limitations section explains how stored classifications, image predictions and missing measurements must be interpreted.', 9.2);

      doc.addPage();
      heading('Interpretation and limitations');
      content.limitations.forEach(text => paragraph(text, 8.8));

      doc.addPage();
      heading('Evidence register');
      paragraph('Risk values below preserve the source records. Only stored confirmed classifications contribute to the high / medium / low summary counts. GPS is WGS84 latitude, longitude. Confidence is the stored model value, not a probability of safety.');
      const evidence = [
        ...content.snapshot.detections.map((row, index) => ({ row, kind: 'detection', index })),
        ...content.snapshot.observations.map((row, index) => ({ row, kind: 'observation', index }))
      ];
      if (!evidence.length) paragraph('No detection or observation records were stored for this mission.');
      else table(['Source record', 'Classification', 'Risk', 'GPS lat, lon', 'Confidence'], evidence.map(({ row, kind, index }) => {
        const gps = coordinates(row); const score = confidence(row);
        return [recordId(row, kind, index), classification(row).replace(/_/g, ' '), riskBand(row) ?? 'Unknown', gps ? `${gps.latitude}, ${gps.longitude}` : 'Unknown / invalid', score === null ? 'Unknown' : `${(score * 100).toFixed(2)}%`];
      }), [92, 115, 65, 146, width - 418]);
      if (content.snapshot.firebase_events?.length) {
        heading('Firebase timestamp matching', 6);
        paragraph('Mapped positions below identify the aircraft at image capture. Unmatched records have no map position and are preserved in the inbox appendix.');
        table(['Firebase record', 'Match state', 'Capture UTC', 'GPS time gap'], content.snapshot.firebase_events.map(row => [row.firebase_id, row.status, row.match?.capture_timestamp || 'Invalid / missing', row.match?.gap_seconds == null ? 'No sample' : `${row.match.gap_seconds} s`]), [145, 120, 160, width - 425]);
      }
      heading('Imagery and localization references', 6);
      if (!evidence.length) paragraph('No imagery references were stored.');
      evidence.forEach(({ row, kind, index }) => {
        const refs = ['image_path', 'imageRef', 'image_url', 'annotated_image_url', 'frameRef', 'thumbnailUrl', 'fullFrameUrl', 'gradCamRef']
          .filter(key => row[key] !== undefined && row[key] !== null).map(key => `${key}: ${row[key]}`);
        ensure(45);
        font('Helvetica-Bold', 8.8); doc.text(printable(recordId(row, kind, index)), MARGIN, doc.y, { width });
        paragraph(refs.length ? refs.join('\n') : 'No imagery reference recorded.', 8.5);
      });
      paragraph('References identify source paths or URLs only. Images were not fetched or authenticated during report generation. GPS, altitude datum, localization uncertainty and sensor standoff are unknown where the source did not provide them.', 8.7);

      if (content.snapshot.inference_runs.length) {
        doc.addPage();
        heading('Image inference results');
        paragraph('These are actual stored model predictions for uploaded images. They are not confirmed mines. Target locations are unknown unless explicitly established by the source; image-level GPS is not a target geolocation. Image-only outputs do not contribute to the evidence counts above.');
        content.snapshot.inference_runs.forEach((run, index) => {
          heading(`Run ${index + 1} / ${recordId(run, 'inference_run', index)}`, 4);
          const refs = ['image_file', 'annotated_file'].filter(key => typeof run[key] === 'string')
            .map(key => `${key}: ${/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(run[key]) ? '/api/inference/files/' + run[key] : run[key]}`);
          for (const key of ['image', 'imageUrl', 'annotatedImageUrl', 'original_filename']) {
            if (run[key] != null) refs.push(`${key}: ${typeof run[key] === 'object' ? JSON.stringify(run[key]) : run[key]}`);
          }
          paragraph(`Model: ${typeof run.model === 'object' ? JSON.stringify(run.model) : run.model ?? 'Unknown'}\n${refs.join('\n')}`, 8.5);
          const predictions = Array.isArray(run.predictions) ? run.predictions : [];
          if (!predictions.length) paragraph('The model returned no predictions for this run.');
          else table(['Class', 'Confidence', 'Bounding box [x1,y1,x2,y2]', 'Normalized center'], predictions.map(prediction => {
            const value = confidence(prediction);
            return [prediction.className ?? prediction.classId ?? 'Unknown', value === null ? 'Unknown' : `${(value * 100).toFixed(2)}%`,
              JSON.stringify(prediction.bbox ?? null), JSON.stringify(prediction.normalizedCenter ?? null)];
          }), [110, 74, 184, width - 368]);
          paragraph(run.target_location_known === true ? 'Target localization is asserted by the stored source. See the full source fields for its method and limitations.' : 'Target locations are unknown. No per-object GPS was inferred from this image.', 8.6);
        });
      }

      if (content.narrative) {
        doc.addPage();
        heading('Optional AI narrative');
        paragraph('Generated by the configured RAG service from the cited mission sources. This narrative is advisory and may contain errors. The frozen records and confirmed-only summary remain the authoritative report contents.');
        paragraph(content.narrative, 10, INK);
        heading('Narrative citations', 8);
        content.narrativeSources.forEach(source => {
          paragraph(`[${source.citationNumber}] ${source.document} / ${source.section}\nRecord: ${source.sourceRecordId ?? 'mission summary'}\n${source.snippet}`, 8.7);
        });
      }

      doc.addPage();
      heading('Provenance and integrity');
      paragraph(`Source SHA256\n${content.sourceHash}`, 8.5);
      paragraph(`Content SHA256\n${contentHash}`, 8.5);
      for (const [key, value] of Object.entries(content.hashSemantics)) paragraph(`${key}: ${value}`, 8.8);
      paragraph('PDF and CSV byte SHA256 values are exposed in report metadata and the saved manifest. They are not embedded in their own files, which would create a circular hash. Hashes provide content references and change detection; they are not digital signatures or proof of sensor authenticity.');
      paragraph('Each source record has a SHA256 reference in the appendix. Complete source fields, including vendor-specific telemetry, are frozen below and included in the CSV. Characters outside printable ASCII are shown with a visible \\u escape in source fields; the CSV preserves the original UTF-8.');

      for (const [collection, kind, title] of [
        ['missions', 'mission', 'Mission registry'], ['detections', 'detection', 'Detection evidence'],
        ['observations', 'observation', 'Observation evidence'], ['telemetry', 'telemetry', 'Telemetry'],
        ['inference_runs', 'inference_run', 'Image inference runs'],
        ['firebase_events', 'firebase_event', 'Firebase detection inbox']
      ]) {
        if (!content.snapshot[collection]?.length) continue;
        doc.addPage();
        heading(`Full source appendix - ${title}`);
        content.snapshot[collection].forEach((row, index) => {
          ensure(100);
          font('Helvetica-Bold', 10); doc.text(printable(`${kind} ${index + 1} / ${recordId(row, kind, index)}`), MARGIN, doc.y, { width });
          doc.moveDown(0.35);
          paragraph(`SHA256 ${hash(row)}`, 7.6);
          font('Courier', 8.2, INK);
          const json = JSON.stringify(row, null, 2).replace(/[^\x20-\x7e\n\r\t]/g, character => '\\u' + character.charCodeAt(0).toString(16).padStart(4, '0'));
          doc.text(json, MARGIN, doc.y, { width, lineGap: 1.8 });
          doc.y += 16;
        });
      }

      const pages = doc.bufferedPageRange();
      for (let page = pages.start; page < pages.start + pages.count; page++) {
        doc.switchToPage(page);
        doc.strokeColor('#c4d3ca').lineWidth(0.7).moveTo(MARGIN, 806).lineTo(MARGIN + width, 806).stroke();
        font('Helvetica', 7.5, MUTED);
        const label = content.synthetic ? 'SYNTHETIC DATA  /  NOT A CLEARANCE CERTIFICATE' : 'MISSION SNAPSHOT  /  NOT A CLEARANCE CERTIFICATE';
        doc.text(label, MARGIN, 815, { lineBreak: false });
        const pageLabel = `${page + 1} / ${pages.count}`;
        // A width option enables PDFKit's line wrapper even with lineBreak:false;
        // that wrapper would create a new page below the content margin.
        doc.text(pageLabel, MARGIN + width - doc.widthOfString(pageLabel), 815, { lineBreak: false });
      }
      doc.end();
    } catch (error) { doc.destroy(); reject(error); }
  });
}

module.exports = { createPdf };
