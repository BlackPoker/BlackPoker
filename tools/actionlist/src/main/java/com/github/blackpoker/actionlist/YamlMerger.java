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
    public static void main(String[] args) {
        if (args.length < 2) {
            System.err.println("Usage: java -jar <jarfile> <yaml1> <yaml2> [<out>]");
            System.exit(1);
        }
        Yaml yaml = new Yaml();
        try (InputStream in1 = new FileInputStream(args[0]);
                InputStream in2 = new FileInputStream(args[1])) {

            // LinkedHashMap で読み込んで順序キープ
            Map<String, Object> map1 = yaml.loadAs(in1, LinkedHashMap.class);
            Map<String, Object> map2 = yaml.loadAs(in2, LinkedHashMap.class);

            // ① data を丸ごと退避し、両マップから取り除く
            Object data1 = map1.remove("data");
            map2.remove("data");

            // ② 残りをマージ
            Map<String, Object> mergedBody = mergeMaps(map1, map2);

            // ③ data を先頭に戻して最終結果を作成
            LinkedHashMap<String, Object> finalMap = new LinkedHashMap<>();
            finalMap.put("data", data1);
            finalMap.putAll(mergedBody);

            // Dump
            DumperOptions opts = new DumperOptions();
            opts.setDefaultFlowStyle(DumperOptions.FlowStyle.BLOCK);
            opts.setPrettyFlow(true);
            Yaml dumper = new Yaml(opts);
            String output = dumper.dump(finalMap);

            System.out.print(output);
            if (args.length >= 3) {
                Files.write(Paths.get(args[2]), output.getBytes(StandardCharsets.UTF_8));
                System.out.println("Merged YAML written to " + args[2]);
            }

        } catch (Exception e) {
            e.printStackTrace();
            System.exit(1);
        }
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> mergeMaps(Map<String, Object> m1, Map<String, Object> m2) {
        Map<String, Object> result = new LinkedHashMap<>(m1);

        for (Map.Entry<String, Object> e : m2.entrySet()) {
            String key = e.getKey();
            Object v2 = e.getValue();

            if (!result.containsKey(key)) {
                // map1 にないキーはそのまま追加
                result.put(key, v2);

            } else {
                Object v1 = result.get(key);

                // Map vs Map → 再帰マージ
                if (v1 instanceof Map && v2 instanceof Map) {
                    result.put(key, mergeMaps((Map<String, Object>) v1, (Map<String, Object>) v2));

                    // List vs List → 要素が 'type' をキーに持つ Map ならキーごとにマージ、それ以外は連結
                } else if (v1 instanceof List && v2 instanceof List) {
                    List<Object> list1 = (List<Object>) v1;
                    List<Object> list2 = (List<Object>) v2;
                    if (isTypeKeyedList(list1) && isTypeKeyedList(list2)) {
                        result.put(key, mergeByType(list1, list2));
                    } else {
                        List<Object> mergedList = new ArrayList<>(list1);
                        mergedList.addAll(list2);
                        result.put(key, mergedList);
                    }

                    // それ以外 → map2 で上書き（必要に応じて v1 を優先するよう変えてもOK）
                } else {
                    result.put(key, v2);
                }
            }
        }
        return result;
    }

    /** リストの最初の要素が Map かつ 'type' キーを持つかどうか */
    private static boolean isTypeKeyedList(List<Object> list) {
        return !list.isEmpty()
                && list.get(0) instanceof Map
                && ((Map<?, ?>) list.get(0)).containsKey("type");
    }

    /**
     * 'type' キーを持つ Map 要素のリストを、type 値ごとに再帰マージして返す。
     */
    @SuppressWarnings("unchecked")
    private static List<Object> mergeByType(List<Object> l1, List<Object> l2) {
        // type値 → 要素 Map の順序保持マップ
        Map<Object, Map<String, Object>> temp = new LinkedHashMap<>();
        for (Object o : l1) {
            Map<String, Object> m = (Map<String, Object>) o;
            temp.put(m.get("type"), new LinkedHashMap<>(m));
        }
        for (Object o : l2) {
            Map<String, Object> m = (Map<String, Object>) o;
            Object type = m.get("type");
            if (temp.containsKey(type)) {
                temp.put(type, mergeMaps(temp.get(type), m));
            } else {
                temp.put(type, new LinkedHashMap<>(m));
            }
        }
        return new ArrayList<>(temp.values());
    }
}
