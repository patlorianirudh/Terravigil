import type {
  InferenceModel,
  InferencePrediction,
  InferenceRequest,
  InferenceResult,
  InferenceStatus,
} from '../domain/types';
import { config } from '../config';
import { apiAssetUrl } from './assetUrl';
import { ServiceError } from './errors';
import { request } from './http';

type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as RecordValue) : {};
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const nonempty = (value: unknown): value is string =>
  typeof value === 'string' && value.trim() !== '';
const invalidOutput = () =>
  new ServiceError('invalid', 'The backend returned an unreadable inference result.');

function model(value: unknown): InferenceModel {
  const dto = record(value);
  if (!nonempty(dto.name)) throw invalidOutput();
  return {
    name: dto.name,
    sha256: nonempty(dto.sha256) ? dto.sha256 : null,
    ...(nonempty(dto.task) ? { task: dto.task } : {}),
    ...(nonempty(dto.device) ? { device: dto.device } : {}),
    classes: (Array.isArray(dto.classes) ? dto.classes : []).map((value: unknown) => {
      const item = record(value);
      if (!Number.isInteger(item.id) || !nonempty(item.name)) throw invalidOutput();
      return { id: item.id as number, name: item.name };
    }),
  };
}

export async function readInferenceStatus(): Promise<InferenceStatus> {
  const dto = record(
    await request<unknown>('/inference/status', { timeoutMs: config.preparationTimeoutMs }),
  );
  const limits = record(dto.limits);
  if (
    typeof dto.ready !== 'boolean' ||
    !['ready', 'unavailable', 'busy'].includes(String(dto.status)) ||
    !finite(limits.maxImageBytes) ||
    limits.maxImageBytes <= 0 ||
    !finite(limits.maxImagePixels) ||
    limits.maxImagePixels <= 0 ||
    !finite(limits.minConfidence) ||
    !finite(limits.maxConfidence) ||
    limits.minConfidence <= 0 ||
    limits.maxConfidence > 1 ||
    limits.minConfidence > limits.maxConfidence
  )
    throw invalidOutput();
  const error = record(dto.error);
  return {
    ready: dto.ready,
    status: dto.status as InferenceStatus['status'],
    model: model(dto.model),
    runtime: Object.fromEntries(
      Object.entries(record(dto.runtime)).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    ),
    limits: {
      maxImageBytes: limits.maxImageBytes,
      maxImagePixels: limits.maxImagePixels,
      minConfidence: limits.minConfidence,
      maxConfidence: limits.maxConfidence,
    },
    ...(nonempty(error.code) && nonempty(error.message)
      ? { error: { code: error.code, message: error.message } }
      : {}),
  };
}

export async function runImageInference(input: InferenceRequest): Promise<InferenceResult> {
  const hasLatitude = input.latitude !== undefined;
  const hasLongitude = input.longitude !== undefined;
  if (
    !input.imageBase64.trim() ||
    !input.filename.trim() ||
    (input.confidence !== undefined &&
      (!finite(input.confidence) || input.confidence < 0.01 || input.confidence > 1)) ||
    hasLatitude !== hasLongitude ||
    (hasLatitude &&
      (!finite(input.latitude) ||
        Math.abs(input.latitude) > 90 ||
        !finite(input.longitude) ||
        Math.abs(input.longitude) > 180))
  )
    throw new ServiceError(
      'invalid',
      'Choose an image, a confidence threshold from 0.01 to 1, and either both GPS coordinates or neither.',
    );
  const dto = record(
    await request<unknown>('/inference/predict', {
      method: 'POST',
      body: input,
      timeoutMs: config.preparationTimeoutMs,
    }),
  );
  const imageUrl = apiAssetUrl(dto.imageUrl);
  const annotatedImageUrl = apiAssetUrl(dto.annotatedImageUrl);
  const dimensions = record(dto.image);
  if (
    !nonempty(dto.runId) ||
    !nonempty(dto.missionId) ||
    !Array.isArray(dto.predictions) ||
    imageUrl === null ||
    annotatedImageUrl === null ||
    !finite(dimensions.width) ||
    dimensions.width <= 0 ||
    !finite(dimensions.height) ||
    dimensions.height <= 0 ||
    !Number.isInteger(dto.persistedObservations) ||
    Number(dto.persistedObservations) < 0 ||
    Number(dto.persistedObservations) > dto.predictions.length
  )
    throw invalidOutput();
  const predictions: InferencePrediction[] = dto.predictions.map((value: unknown) => {
    const item = record(value);
    const center = record(item.normalizedCenter);
    const bbox = item.bbox;
    if (
      !Number.isInteger(item.classId) ||
      Number(item.classId) < 0 ||
      !nonempty(item.className) ||
      !finite(item.confidence) ||
      item.confidence < 0 ||
      item.confidence > 1 ||
      !Array.isArray(bbox) ||
      bbox.length !== 4 ||
      !bbox.every((v) => finite(v) && v >= 0) ||
      Number(bbox[2]) < Number(bbox[0]) ||
      Number(bbox[3]) < Number(bbox[1]) ||
      !finite(center.x) ||
      center.x < 0 ||
      center.x > 1 ||
      !finite(center.y) ||
      center.y < 0 ||
      center.y > 1
    )
      throw invalidOutput();
    return {
      classId: item.classId as number,
      className: item.className,
      confidence: item.confidence,
      bbox: bbox as [number, number, number, number],
      normalizedCenter: { x: center.x, y: center.y },
    };
  });
  return {
    runId: dto.runId,
    missionId: dto.missionId,
    model: model(dto.model),
    predictions,
    imageUrl,
    annotatedImageUrl,
    image: { width: dimensions.width, height: dimensions.height },
    persistedObservations: dto.persistedObservations as number,
  };
}
