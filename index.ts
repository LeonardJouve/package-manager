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
    version: string;
    parents: string[];
    dependencies: Dependency[];
};

const REGISTRY = "https://registry.npmjs.org";
const MODULE_DIRECTORY = path.join(process.cwd(), "modules");

const getDependencyMetadatas = async (dependency: string): Promise<PackageMetadatas> => {
    const response = await fetch(`${REGISTRY}/${dependency}`);
    const data = await response.json();

    return v.parse(PackageMetadatasSchema, data);
};

const getDependencies = async (dependencies: Record<string, string>, parents: string[] = []) => {
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
                version: chosenVersion,
                parents,
                dependencies: [],
            };

            const nestedDependencies = versionMetadatas.dependencies ?? {};
            dependency.dependencies = await getDependencies(nestedDependencies, [...parents, metadatas.name]);

            return dependency;
        }),
    );
};

const downloadDependency = async (link: string, to: string) => {
    const response = await fetch(link);
    if (!response.body) {
        throw new Error(`failed to download dependency "${link}"`);
    }

    const tmp = await fs.mkdtemp(path.join(MODULE_DIRECTORY, "tmp-"));

    await stream.pipeline(response.body, tar.x({C: tmp}));
    await fs.mkdir(path.dirname(to), {recursive: true});
    await fs.rename(path.join(tmp, "package"), to);
    await fs.rm(tmp, {recursive: true, force: true});
};

const groupDependencies = (dependencies: Dependency[]): Map<string, Dependency[]> => {
    const result = new Map<string, Dependency[]>();
    const add = (name: string, dependency: Dependency) => {
        if (!result.has(name)) {
            result.set(name, []);
        }

        result.get(name)?.push(dependency);
    };

    for (const dependency of dependencies) {
        add(dependency.name, dependency);
        const nestedDependencies = groupDependencies(dependency.dependencies);
        nestedDependencies.forEach((dependencies, name) => {
            dependencies.forEach((dependency) => add(name, dependency));
        });
    }

    return result;
};

type Plan = {
    dependency: Dependency;
    output: string;
}[];
const getDownloadPlan = (dependencies: Dependency[]): Plan => {
    const plan: Plan = [];

    groupDependencies(dependencies).forEach((versions, name) => {
        const [dependency, ...rest] = versions;
        if (!dependency) {
            return;
        }

        plan.push({dependency, output: path.join(MODULE_DIRECTORY, name)});
        rest.forEach((dependency) => {
            plan.push({
                dependency,
                output: path.join(
                    MODULE_DIRECTORY,
                    ...dependency.parents.flatMap((parent) => [parent, path.basename(MODULE_DIRECTORY)]),
                    name
                ),
            });
        });
    });

    return plan.sort((a, b) => a.dependency.parents.length - b.dependency.parents.length);
};

const packages = JSON.parse(await fs.readFile("./packages.json", "utf-8"));

const tree = await getDependencies(packages.dependencies);

await fs.rm(MODULE_DIRECTORY, {recursive: true, force: true});
await fs.mkdir(MODULE_DIRECTORY);

const plan = getDownloadPlan(tree);
for (const {dependency, output} of plan) {
    console.log(`downloading ${dependency.name}@${dependency.version} in ${output}`);
    await downloadDependency(dependency.tarball, output);
}
