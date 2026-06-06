package com.github.blackpoker.actionlist;

import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.LinkedHashMap;
import java.util.Map;
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
}
