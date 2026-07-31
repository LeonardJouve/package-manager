import * as v from "valibot";

export const SignatureSchema = v.object({
    sig: v.string(),
    keyid: v.string(),
});

export const DistSchema = v.object({
    shasum: v.string(),
    tarball: v.string(),
    integrity: v.string(),
    signatures: v.optional(v.array(SignatureSchema)),
});

export const VersionMetadatasSchema = v.object({
    name: v.string(),
    version: v.string(),
    dist: DistSchema,
    dependencies: v.optional(v.record(v.string(), v.string())),
});

export const PackageMetadatasSchema = v.object({
    name: v.string(),
    versions: v.record(v.string(), VersionMetadatasSchema),
});

export type PackageMetadatas = v.InferOutput<typeof PackageMetadatasSchema>;
export type VersionMetadatas = v.InferOutput<typeof VersionMetadatasSchema>;
