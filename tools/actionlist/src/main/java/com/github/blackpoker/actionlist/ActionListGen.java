package com.github.blackpoker.actionlist;

import java.io.IOException;
import java.io.InputStream;
import java.io.StringWriter;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.LinkedHashMap;
import java.util.Map;
import org.kohsuke.args4j.CmdLineParser;
import org.kohsuke.args4j.Option;
import org.yaml.snakeyaml.Yaml;

import com.github.blackpoker.actionlist.writer.HtmlWriter;
import com.github.blackpoker.actionlist.writer.RstWriter;
import com.github.blackpoker.actionlist.writer.TexWriter;

public class ActionListGen {

	// 入力ファイルのパス
	@Option(name = "-i", aliases = { "--input" }, metaVar = "inputPath", required = true, usage = "INPUT YAML")
	private String inputPath;
	// テンプレートファイルのシート名
	@Option(name = "-t", aliases = { "--template" }, metaVar = "templateName", required = true, usage = "TemplateName")
	private String templateName;
	// 出力ファイルのパス
	@Option(name = "-b", aliases = { "--beta" }, usage = "BETA")
	private boolean betaFlg;
	// HTML出力
	@Option(name = "-htmlOutput", aliases = { "--htmlOutput" }, usage = "HTML OUTPUT")
	private String htmlOutputPath;
	// TeX出力
	@Option(name = "-texOutput", aliases = { "--texOutput" }, usage = "TeX OUTPUT")
	private String texOutputPath;
	// rst出力
	@Option(name = "-rstOutput", aliases = { "--rstOutput" }, usage = "rst OUTPUT")
	private String rstOutputPath;
	// パラメータ
	@Option(name = "-arg0", aliases = { "--arg0" }, metaVar = "arg0", usage = "ARG0")
	private String arg0;
	// パラメータ
	@Option(name = "-arg1", aliases = { "--arg1" }, metaVar = "arg1", usage = "ARG1")
	private String arg1;
	// パラメータ
	@Option(name = "-arg2", aliases = { "--arg2" }, metaVar = "arg2", usage = "ARG2")
	private String arg2;

	// シートの設定
	private Map<String, String> conf;

	// private String filePath =
	// "/Users/iichico/Documents/BlackPoker関連/ルール検討/エクストラ.ods";
	// private String outPath
	// ="/Users/iichico/Documents/BlackPoker関連/ルール検討/extra.html";
	public static void main(String[] args) {

		for(String arg : args){
			System.out.println("------------------------------args------------------------------");
			System.out.println(arg);
			
			String[] ag = arg.split("[ ]+");
			
			System.out.println("------------------------------args------------------------------");	
			new ActionListGen().start(ag);
		}
	}

	private void start(String[] args) {

		CmdLineParser parser = new CmdLineParser(this);

		try {
			// parse options
			parser.parseArgument(args);
			this.execute();
		} catch (Exception e) {
			// print usage.
			e.printStackTrace();
			parser.printUsage(System.out);
			System.exit(1);
		}
	}

	public void execute() throws IOException {
		// List<Map<String, String>> listMap = load(inputPath);
		Map<String, Object> map = load(inputPath);

		// HTML書き出し
		if (htmlOutputPath != null && !"".equals(htmlOutputPath)) {
			Writer htmlWriter = new HtmlWriter();
			htmlWriter.write(map, htmlOutputPath, templateName);
		}

		// TeX書き出し
		if (texOutputPath != null && !"".equals(texOutputPath)) {
			Writer pdfWriter = new TexWriter();
			pdfWriter.write(map, texOutputPath, templateName);
		}

		// rst書き出し
		if (rstOutputPath != null && !"".equals(rstOutputPath)) {
			Writer rstWriter = new RstWriter();
			rstWriter.write(map, rstOutputPath, templateName);
		}
		
		// yaml書き出し
		{
			Yaml yaml = new Yaml();
			StringWriter writer = new StringWriter();
			yaml.dump(map, writer);
			System.out.println("-----");
			System.out.println(writer.toString());
			System.out.println("-----");
		}
	}

	// List<Map<String, String>>
	private Map<String, Object> load(String filepath) throws IOException {
		Map<String, Object> ret = new LinkedHashMap<>();
		Path input = Paths.get(filepath);
		Yaml yaml = new Yaml();
		try (InputStream in = Files.newInputStream(input)) {
            
			ret = (Map<String,Object>)yaml.load(in);
			
			System.out.println(ret);
			System.out.println("読み込みました。" + filepath);
        }

		// // 設定値読み込み
		// {
		// 	Map<String, String> config = SheetUtil.loadConfig(sheet);
		// 	this.conf = config;
		// }

		// コマンドライン引数を設定
		{
			ret.put("arg0", this.arg0);
			ret.put("arg1", this.arg1);
			ret.put("arg2", this.arg2);
			if (this.betaFlg) {
				ret.put("beta", this.betaFlg);
			}
		}

		// // ------------------------------------
		// // listX:"開始セル,必須列(0始まり),-r(逆順),リストにまとめる列数(0始まり)"
		// for (int i = 0;; i++) {
		// 	String key;
		// 	if (i == 0) {
		// 		key = "list";
		// 	} else {
		// 		key = "list" + i;
		// 	}

		// 	// keyが存在しない場合、ループを抜ける
		// 	if (!conf.containsKey(key)) {
		// 		break;
		// 	}

		// 	String[] split = conf.get(key).split(",");

		// 	Point point = SheetUtil.getPoint(split[0]);
		// 	int stCol = (int) point.getX();
		// 	int stRow = (int) point.getY();// Integer.parseInt(conf.get("stCol"));

		// 	int reqCol = stCol;
		// 	if (1 < split.length) {
		// 		reqCol = Integer.parseInt(split[1]);
		// 	}

		// 	List<Map<String, String>> listMap = SheetUtil.getListMap(sheet, stCol, stRow, reqCol);

		// 	for (Map<String, String> map : listMap) {
		// 		for (Entry<String, String> entry : map.entrySet()) {
		// 			System.out.println(entry.getKey() + ":" + entry.getValue());
		// 		}
		// 	}

		// 	// reverse設定
		// 	if (2 < split.length && "-r".equals(split[2])) {
		// 		Collections.reverse(listMap);
		// 	}

		// 	// listにまとめる設定
		// 	List<List<Map<String, String>>> wrapList = new ArrayList<>();
		// 	if (3 < split.length && Pattern.matches("[0-9]+", split[3])) {
		// 		int idx = Integer.parseInt(split[3]);

		// 		String idxKey = (String) listMap.get(0).keySet().toArray()[idx];

		// 		String listKeyVal = "";
		// 		for (Map<String, String> m : listMap) {

		// 			// リストにまとめる時のキー値と異なる場合、新しいリストに詰める
		// 			if (!listKeyVal.equals(m.get(idxKey))) {
		// 				listKeyVal = m.get(idxKey);
		// 				List<Map<String, String>> _list = new ArrayList<>();
		// 				wrapList.add(_list);
		// 			}

		// 			// 一番最後のリストに追加する
		// 			wrapList.get(wrapList.size() - 1).add(m);
		// 		}
		// 	}

		// 	// 結果を設定
		// 	if (!wrapList.isEmpty()) {
		// 		// ネストしたlistはlistlistというキーで設定する
		// 		ret.put(key + "list", wrapList);
		// 	}
		// 	ret.put(key, listMap);

		// }

		// // ------------------------------------
		// // dataX:"開始セル"
		// for (int i = 0;; i++) {
		// 	String key;
		// 	if (i == 0) {
		// 		key = "data";
		// 	} else {
		// 		key = "data" + i;
		// 	}

		// 	// keyが存在しない場合、ループを抜ける
		// 	if (!conf.containsKey(key)) {
		// 		break;
		// 	}

		// 	String[] split = conf.get(key).split(",");

		// 	Point point = SheetUtil.getPoint(split[0]);
		// 	int stCol = (int) point.getX();
		// 	int stRow = (int) point.getY();// Integer.parseInt(conf.get("stCol"));

		// 	int reqCol = stCol;
		// 	if (1 < split.length) {
		// 		reqCol = Integer.parseInt(split[1]);
		// 	}

		// 	List<Map<String, String>> listMap = SheetUtil.getListMap(sheet, stCol, stRow, reqCol);

		// 	for (Map<String, String> map : listMap) {
		// 		for (Entry<String, String> entry : map.entrySet()) {
		// 			System.out.println(entry.getKey() + ":" + entry.getValue());
		// 		}
		// 	}

		// 	if (!listMap.isEmpty()) {
		// 		// 結果を設定
		// 		ret.put(key, listMap.get(0));
		// 	}
		// }
		return ret;
	}

}
