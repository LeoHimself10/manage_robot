import { readFileSync, writeFileSync } from "node:fs";

const appRoot = process.env.ADMIN_TEST_OVERLAY_ROOT || "/app";

function replaceOnce(source, before, after, label) {
  const first = source.indexOf(before);
  const last = source.lastIndexOf(before);
  if (first < 0 || first !== last) {
    throw new Error(`[admin-test-overlay] expected exactly one ${label} anchor`);
  }
  return `${source.slice(0, first)}${after}${source.slice(first + before.length)}`;
}

function patchFile(path, transform) {
  const before = readFileSync(path, "utf8");
  const after = transform(before);
  if (after === before) throw new Error(`[admin-test-overlay] ${path} was not changed`);
  writeFileSync(path, after, "utf8");
}

patchFile(`${appRoot}/src/web/assignment-workbench.ts`, (source) => {
  let next = replaceOnce(
    source,
    'import { createPeopleDirectoryStore } from "../infra/people-directory-store";\n',
    'import { createPeopleDirectoryStore } from "../infra/people-directory-store";\n'
      + 'import { isAdminTestActorUserId } from "../testing/admin-test-actors";\n',
    "assignment import",
  );
  next = replaceOnce(
    next,
    "        const redirectTo = defaultPathForRole(next.role, next.userId);",
    "        const redirectTo = isAdminTestActorUserId(next.userId)\n"
      + '          ? "/workbench/quality"\n'
      + "          : defaultPathForRole(next.role, next.userId);",
    "assignment redirect",
  );
  return next;
});

patchFile(`${appRoot}/src/security/quality-capabilities.ts`, (source) => {
  let next = replaceOnce(
    source,
    '} from "./workbench-role-resolver";\n',
    '} from "./workbench-role-resolver";\n'
      + 'import { getAdminTestActor } from "../testing/admin-test-actors";\n',
    "quality capability import",
  );
  next = replaceOnce(
    next,
    "  if (!normalized) return [];\n  const configuredSpecialists",
    "  if (!normalized) return [];\n"
      + '  if (getAdminTestActor(normalized)?.userId === "QUALITY_TEST_AFTERSALES_001") {\n'
      + '    return ["QUALITY_TEST_SPECIALIST_001"];\n'
      + "  }\n"
      + "  const configuredSpecialists",
    "quality report relationship",
  );
  next = replaceOnce(
    next,
    '    ...envUserIds("QUALITY_SPECIALIST_USER_IDS"),\n',
    '    ...envUserIds("QUALITY_SPECIALIST_USER_IDS"),\n'
      + '    ...(getAdminTestActor("QUALITY_TEST_SPECIALIST_001")\n'
      + '      ? ["QUALITY_TEST_SPECIALIST_001"]\n'
      + "      : []),\n",
    "quality specialist list",
  );
  next = replaceOnce(
    next,
    "  }\n\n  const aftersalesManagers = envUserIds",
    "  }\n\n"
      + "  const testActor = getAdminTestActor(normalized);\n"
      + "  if (testActor) {\n"
      + '    const isAftersales = testActor.userId === "QUALITY_TEST_AFTERSALES_001";\n'
      + '    const isQualitySpecialist = testActor.userId === "QUALITY_TEST_SPECIALIST_001";\n'
      + "    return {\n"
      + "      baseRole,\n"
      + '      roles: isAftersales ? ["aftersales_manager"] : isQualitySpecialist ? ["quality_specialist"] : [],\n'
      + "      canAccessTracking: true,\n"
      + "      canAccessOpinions: false,\n"
      + "      canReportQuality: isAftersales,\n"
      + "      canAnalyzeQuality: isQualitySpecialist,\n"
      + "      isBusinessReadOnly: false,\n"
      + "      hasQualityManagement: isQualitySpecialist,\n"
      + "      isProjectManager: isAftersales,\n"
      + "      isQualitySpecialist,\n"
      + '      specialistUserIds: isAftersales ? ["QUALITY_TEST_SPECIALIST_001"] : [],\n'
      + "    };\n"
      + "  }\n\n"
      + "  const aftersalesManagers = envUserIds",
    "quality actor capabilities",
  );
  return next;
});

console.log("[admin-test-overlay] exact yesterday sources patched successfully");
