import fs from "node:fs/promises";
import stream from "node:stream/promises";
import path from "node:path";
import * as tar from "tar";
import semver from "semver";
import * as v from "valibot";
import {PackageMetadatasSchema, type PackageMetadatas} from "./metadatas.ts";

type Dependency = {
    name: string;
    tarball: string;
    // parent: Dependency|null;
    dependencies: Dependency[];
};

const REGISTRY = "https://registry.npmjs.org";

const getDependencyMetadatas = async (dependency: string): Promise<PackageMetadatas> => {
    const response = await fetch(`${REGISTRY}/${dependency}`);
    const data = await response.json();

    return v.parse(PackageMetadatasSchema, data);
};

const getDependencies = async (dependencies: Record<string, string>, parent: Dependency|null = null) => {
    return await Promise.all(Object.entries(dependencies)
        .map(async ([name, version]) => {
            const metadatas = await getDependencyMetadatas(name);
            const versions = Object.keys(metadatas.versions);
            const chosenVersion = semver.maxSatisfying(versions, version);
            if (!chosenVersion) {
                throw new Error(`no valid version found for dependency "${name}" with version "${version}"`);
            }

            const versionMetadatas = metadatas.versions[chosenVersion]!;

            const dependency: Dependency = {
                name: metadatas.name,
                tarball: versionMetadatas.dist.tarball,
                // parent,
                dependencies: [],
            };

            const nestedDependencies = versionMetadatas.dependencies ?? {};
            dependency.dependencies = await getDependencies(nestedDependencies, dependency);

            return dependency;
        }),
    );
};

const downloadDependency = async (link: string, to: string) => {
    const response = await fetch(link);
    if (!response.body) {
        throw new Error(`failed to download dependency "${link}"`);
    }

    const directory = path.dirname(to);

    await stream.pipeline(
        response.body,
        tar.x({C: directory}),
    );

    await fs.rename(path.join(directory, "package"), to);
};

const packages = JSON.parse(await fs.readFile("./packages.json", "utf-8"));
const metadatas = await getDependencies(packages.dependencies);
console.log(JSON.stringify(metadatas, null, 2));
