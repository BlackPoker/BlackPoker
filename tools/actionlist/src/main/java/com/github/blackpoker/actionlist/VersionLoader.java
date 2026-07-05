package com.github.blackpoker.actionlist;

import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.TreeMap;
import org.yaml.snakeyaml.Yaml;

public class VersionLoader {
    private static final String DEFAULT_VERSION_PATH = "original/version.json";

    public static void applyVersion(Map<String, Object> ret) {
        applyVersion(ret, DEFAULT_VERSION_PATH);
    }

    @SuppressWarnings("unchecked")
    public static void applyVersion(Map<String, Object> ret, String versionPathStr) {
        Map<String, Object> data = (Map<String, Object>) ret.get("data");
        if (data == null) {
            data = new LinkedHashMap<>();
            ret.put("data", data);
        }
        applyVersionToData(data, versionPathStr);

        // changed フィールドの自動判定処理
        processChangedFields(ret, versionPathStr);
    }

    public static void applyVersionToData(Map<String, Object> data) {
        applyVersionToData(data, DEFAULT_VERSION_PATH);
    }

    @SuppressWarnings("unchecked")
    public static void applyVersionToData(Map<String, Object> data, String versionPathStr) {
        Path versionPath = Paths.get(versionPathStr);
        if (!Files.exists(versionPath)) {
            return;
        }
        Yaml yaml = new Yaml();
        try (InputStream vin = Files.newInputStream(versionPath)) {
            Map<String, Object> versionData = (Map<String, Object>) yaml.load(vin);
            if (versionData == null) {
                return;
            }

            if (versionData.containsKey("ver")) {
                String ver = (String) versionData.get("ver");
                // data ブロック内に suffix が定義されているかチェックして結合
                if (data.containsKey("suffix")) {
                    Object suffixVal = data.get("suffix");
                    if (suffixVal instanceof String) {
                        ver = ver + (String) suffixVal;
                    }
                }
                data.put("ver", ver);
            }
            if (versionData.containsKey("lastupdate")) {
                data.put("lastupdate", versionData.get("lastupdate"));
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    @SuppressWarnings("unchecked")
    private static void processChangedFields(Map<String, Object> ret, String versionPathStr) {
        String targetVer = null;
        boolean beta = false;

        Path versionPath = Paths.get(versionPathStr);
        if (Files.exists(versionPath)) {
            Yaml yaml = new Yaml();
            try (InputStream vin = Files.newInputStream(versionPath)) {
                Map<String, Object> versionData = (Map<String, Object>) yaml.load(vin);
                if (versionData != null) {
                    if (versionData.containsKey("target_ver")) {
                        targetVer = String.valueOf(versionData.get("target_ver"));
                    }
                    if (versionData.containsKey("beta")) {
                        Object betaVal = versionData.get("beta");
                        if (betaVal instanceof Boolean) {
                            beta = (Boolean) betaVal;
                        } else if (betaVal instanceof String) {
                            beta = Boolean.parseBoolean((String) betaVal);
                        }
                    }
                }
            } catch (Exception e) {
                e.printStackTrace();
            }
        }

        String targetVerNorm = normalizeVersion(targetVer);
        Map<String, Integer> verStats = new TreeMap<>(); // バージョンごとの更新数統計

        processList(ret.get("actList"), targetVerNorm, beta, verStats);
        processList(ret.get("charList"), targetVerNorm, beta, verStats);
        processList(ret.get("fogList"), targetVerNorm, beta, verStats);
        processList(ret.get("trumpList"), targetVerNorm, beta, verStats);

        // ログ出力
        System.out.println("=================================================");
        System.out.println("--- [Version & Red Mark Information] ---");
        System.out.println("  Beta Mode            : " + (beta ? "ON (Show Red Marks)" : "OFF (Hide Red Marks)"));
        System.out.println("  Target Version       : " + (targetVer != null ? targetVer : "N/A"));
        System.out.println("--- Version Stats (since / update count) ---");
        for (Map.Entry<String, Integer> entry : verStats.entrySet()) {
            String verStr = entry.getKey();
            int count = entry.getValue();
            boolean isCurrentTarget = beta && verStr.equals(targetVerNorm);
            System.out.printf("  Version %-10s : %d items %s%n", 
                verStr, count, isCurrentTarget ? "<- [SHOWN IN RED]" : "");
        }
        System.out.println("=================================================");
    }

    private static String normalizeVersion(String ver) {
        if (ver == null) {
            return "";
        }
        return ver.trim().toLowerCase().replaceAll("^v", "");
    }

    private static void processList(Object listObj, String targetVerNormalized, boolean beta, Map<String, Integer> verStats) {
        if (!(listObj instanceof Collection<?>)) {
            return;
        }
        for (Object groupObj : (Collection<?>) listObj) {
            if (!(groupObj instanceof Map<?, ?>)) {
                continue;
            }
            Map<?, ?> group = (Map<?, ?>) groupObj;
            Object itemsObj = null;
            if (group.containsKey("acts")) {
                itemsObj = group.get("acts");
            } else if (group.containsKey("chars")) {
                itemsObj = group.get("chars");
            } else if (group.containsKey("fogs")) {
                itemsObj = group.get("fogs");
            } else if (group.containsKey("trumps")) {
                itemsObj = group.get("trumps");
            }

            if (itemsObj instanceof Collection<?>) {
                for (Object itemObj : (Collection<?>) itemsObj) {
                    if (itemObj instanceof Map<?, ?>) {
                        @SuppressWarnings("unchecked")
                        Map<String, Object> item = (Map<String, Object>) itemObj;
                        
                        String since = item.containsKey("since") ? String.valueOf(item.get("since")) : null;
                        String update = item.containsKey("update") ? String.valueOf(item.get("update")) : null;

                        if (since != null) {
                            String sNorm = normalizeVersion(since);
                            if (!sNorm.isEmpty()) {
                                verStats.put(sNorm, verStats.getOrDefault(sNorm, 0) + 1);
                            }
                        }
                        if (update != null) {
                            String uNorm = normalizeVersion(update);
                            if (!uNorm.isEmpty()) {
                                verStats.put(uNorm, verStats.getOrDefault(uNorm, 0) + 1);
                            }
                        }

                        boolean isMatch = false;
                        if (beta && targetVerNormalized != null && !targetVerNormalized.isEmpty()) {
                            if (since != null && normalizeVersion(since).equals(targetVerNormalized)) {
                                isMatch = true;
                            }
                            if (update != null && normalizeVersion(update).equals(targetVerNormalized)) {
                                isMatch = true;
                            }
                        }

                        if (isMatch) {
                            item.put("changed", "changed");
                        } else {
                            item.remove("changed");
                        }
                    }
                }
            }
        }
    }
}
