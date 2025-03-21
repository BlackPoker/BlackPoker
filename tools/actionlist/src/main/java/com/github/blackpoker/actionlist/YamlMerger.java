package com.github.blackpoker.actionlist;

import org.yaml.snakeyaml.Yaml;
import org.yaml.snakeyaml.DumperOptions;

import java.io.FileInputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.*;

public class YamlMerger {

    @SuppressWarnings("unchecked")
    public static void main(String[] args) {
        if (args.length < 2) {
            System.err.println("Usage: java -jar <jarfile> <yamlFile1> <yamlFile2>");
            System.exit(1);
        }

        String yamlFile1 = args[0];
        String yamlFile2 = args[1];

        Yaml yaml = new Yaml();
        try (InputStream input1 = new FileInputStream(yamlFile1);
             InputStream input2 = new FileInputStream(yamlFile2)) {

            Object obj1 = yaml.load(input1);
            Object obj2 = yaml.load(input2);

            if (!(obj1 instanceof Map) || !(obj2 instanceof Map)) {
                System.err.println("YAML のルートはマッピング（Map）である必要があります。");
                System.exit(1);
            }

            Map<String, Object> map1 = (Map<String, Object>) obj1;
            Map<String, Object> map2 = (Map<String, Object>) obj2;

            Map<String, Object> merged = mergeMaps(map1, map2);

            // 出力用のオプションを設定（順序を保持し、ブロック形式で出力）
            DumperOptions options = new DumperOptions();
            options.setDefaultFlowStyle(DumperOptions.FlowStyle.BLOCK);
            options.setPrettyFlow(true);
            Yaml yamlDumper = new Yaml(options);
            String output = yamlDumper.dump(merged);
            System.out.println(output);

            if (args.length >= 3) {
                String outputPath = args[2];
                Files.write(Paths.get(outputPath), output.getBytes(StandardCharsets.UTF_8));
                System.out.println("Merged YAML written to " + outputPath);
            }

        } catch (Exception e) {
            e.printStackTrace();
            System.exit(1);
        }
    }

    /**
     * map1 をベースにして、map2 の内容をマージする。
     * ・両方の値がMapの場合は再帰的にマージ
     * ・両方がListの場合は map1 のリストの末尾に map2 のリストを追加
     * ・その他の場合は map1 の値をそのまま保持
     */
    @SuppressWarnings("unchecked")
    private static Map<String, Object> mergeMaps(Map<String, Object> map1, Map<String, Object> map2) {
        // LinkedHashMap を利用して順序を保持
        Map<String, Object> merged = new LinkedHashMap<>();

        // まず map1 の全エントリを追加
        for (String key : map1.keySet()) {
            merged.put(key, map1.get(key));
        }

        // 次に map2 の各エントリについて処理
        for (String key : map2.keySet()) {
            if (merged.containsKey(key)) {
                Object value1 = merged.get(key);
                Object value2 = map2.get(key);
                if (value1 instanceof Map && value2 instanceof Map) {
                    merged.put(key, mergeMaps((Map<String, Object>) value1, (Map<String, Object>) value2));
                } else if (value1 instanceof List && value2 instanceof List) {
                    List<Object> mergedList = new ArrayList<>();
                    mergedList.addAll((List<Object>) value1);
                    mergedList.addAll((List<Object>) value2);
                    merged.put(key, mergedList);
                } else {
                    // 同一キーだがリストやMapでない場合は、元の値（map1側）を維持
                    // 必要に応じてここで値を上書きする実装に変更可能
                }
            } else {
                // map1 に存在しないキーはそのまま追加
                merged.put(key, map2.get(key));
            }
        }
        return merged;
    }
}
