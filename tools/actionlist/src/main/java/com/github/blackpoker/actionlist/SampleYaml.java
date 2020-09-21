package com.github.blackpoker.actionlist;

import java.awt.Point;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Map.Entry;
import java.util.regex.Pattern;

import org.jopendocument.dom.spreadsheet.Sheet;
import org.jopendocument.dom.spreadsheet.SpreadSheet;
import org.yaml.snakeyaml.Yaml;

public class SampleYaml {

    public static void main(String[] args) throws IOException {

        // Path input = Paths.get("original/v5-act.yaml");
        // try (InputStream in = Files.newInputStream(input)) {
        //     Yaml yaml = new Yaml();
        //     Map<String, Object> map = (Map<String, Object>) yaml.load(in);
        //     System.out.println(map);
        // }

        Map<String, Object> load = load("original/v5-extra.ods");
        Yaml yaml = new Yaml();
        System.out.println("------------------------------");
        System.out.println(yaml.dump(load));
        
            // Map<String, Object> map = (Map<String, Object>) yaml.load(in);
            // System.out.println(map);
        

    }

    // List<Map<String, String>>
    private static Map<String, Object> load(String filepath) throws IOException {
        File file = new File(filepath);
        SpreadSheet wb = SpreadSheet.createFromFile(file);
        Sheet sheet = wb.getSheet("list");

        System.out.println("読み込みました。" + filepath + " " + "list");

        Map<String, Object> ret = new LinkedHashMap<>();

        // 設定値読み込み

        Map<String, String> conf = SheetUtil.loadConfig(sheet);

        // コマンドライン引数を設定
        {
            // ret.put("arg0", this.arg0);
            // ret.put("arg1", this.arg1);
            // ret.put("arg2", this.arg2);
            // if (this.betaFlg) {
            //     ret.put("beta", this.betaFlg);
            // }
        }

        // ------------------------------------
        // listX:"開始セル,必須列(0始まり),-r(逆順),リストにまとめる列数(0始まり)"
        for (int i = 0;; i++) {
            String key;
            if (i == 0) {
                key = "list";
            } else {
                key = "list" + i;
            }

            // keyが存在しない場合、ループを抜ける
            if (!conf.containsKey(key)) {
                break;
            }

            String[] split = conf.get(key).split(",");

            Point point = SheetUtil.getPoint(split[0]);
            int stCol = (int) point.getX();
            int stRow = (int) point.getY();// Integer.parseInt(conf.get("stCol"));

            int reqCol = stCol;
            if (1 < split.length) {
                reqCol = Integer.parseInt(split[1]);
            }

            List<Map<String, String>> listMap = SheetUtil.getListMap(sheet, stCol, stRow, reqCol);

            for (Map<String, String> map : listMap) {
                for (Entry<String, String> entry : map.entrySet()) {
                    System.out.println(entry.getKey() + ":" + entry.getValue());
                }
            }

            // reverse設定
            if (2 < split.length && "-r".equals(split[2])) {
                Collections.reverse(listMap);
            }

            // listにまとめる設定
            List<List<Map<String, String>>> wrapList = new ArrayList<>();
            if (3 < split.length && Pattern.matches("[0-9]+", split[3])) {
                int idx = Integer.parseInt(split[3]);

                String idxKey = (String) listMap.get(0).keySet().toArray()[idx];

                String listKeyVal = "";
                for (Map<String, String> m : listMap) {

                    // リストにまとめる時のキー値と異なる場合、新しいリストに詰める
                    if (!listKeyVal.equals(m.get(idxKey))) {
                        listKeyVal = m.get(idxKey);
                        wrapList.add(new ArrayList<Map<String, String>>());
                    }

                    // 一番最後のリストに追加する
                    wrapList.get(wrapList.size() - 1).add(m);
                }
            }

            // 結果を設定
            if (!wrapList.isEmpty()) {
                // ネストしたlistはlistlistというキーで設定する
                ret.put(key + "list", wrapList);
            }
            ret.put(key, listMap);

        }

        // ------------------------------------
        // dataX:"開始セル"
        for (int i = 0;; i++) {
            String key;
            if (i == 0) {
                key = "data";
            } else {
                key = "data" + i;
            }

            // keyが存在しない場合、ループを抜ける
            if (!conf.containsKey(key)) {
                break;
            }

            String[] split = conf.get(key).split(",");

            Point point = SheetUtil.getPoint(split[0]);
            int stCol = (int) point.getX();
            int stRow = (int) point.getY();// Integer.parseInt(conf.get("stCol"));

            int reqCol = stCol;
            if (1 < split.length) {
                reqCol = Integer.parseInt(split[1]);
            }

            List<Map<String, String>> listMap = SheetUtil.getListMap(sheet, stCol, stRow, reqCol);

            for (Map<String, String> map : listMap) {
                for (Entry<String, String> entry : map.entrySet()) {
                    System.out.println(entry.getKey() + ":" + entry.getValue());
                }
            }

            if (!listMap.isEmpty()) {
                // 結果を設定
                ret.put(key, listMap.get(0));
            }
        }
        return ret;
    }

}
