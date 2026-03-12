package com.github.blackpoker.actionlist;

import java.io.IOException;
import java.io.InputStream;
import java.io.StringWriter;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.kohsuke.args4j.CmdLineParser;
import org.kohsuke.args4j.Option;
import org.yaml.snakeyaml.Yaml;

import com.github.blackpoker.actionlist.writer.CsvWriter;
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
	// rst出力
	@Option(name = "-csvOutput", aliases = { "--csvOutput" }, usage = "csv OUTPUT")
	private String csvOutputPath;

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

		for (String arg : args) {
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

		// csv書き出し
		if (csvOutputPath != null && !"".equals(csvOutputPath)) {
			Writer csvWriter = new CsvWriter();
			csvWriter.write(map, csvOutputPath, templateName);
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

			ret = (Map<String, Object>) yaml.load(in);

			System.out.println(ret);
			System.out.println("読み込みました。" + filepath);
		}

		// // 設定値読み込み
		// {
		// Map<String, String> config = SheetUtil.loadConfig(sheet);
		// this.conf = config;
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

		// 切札→アクション/キャラクターのマッピングを構築
		buildTrumpRelations(ret);

		return ret;
	}

	/**
	 * actList / charList を走査し、type が「切札」で始まるエントリについて
	 * type をキーとして関連アクション・キャラクターのリストをまとめた
	 * trumpRelations マップを構築し、ret に追加する。
	 *
	 * trumpRelations: Map&lt;String, Map&lt;String, List&lt;Map&gt;&gt;&gt;
	 * key = type (例: "切札♠A 革命")
	 * value = { "acts": [...], "chars": [...] }
	 */
	@SuppressWarnings("unchecked")
	private void buildTrumpRelations(Map<String, Object> ret) {
		Map<String, Map<String, Object>> relations = new LinkedHashMap<>();

		// actList から切札関連アクションを収集
		Object actListObj = ret.get("actList");
		if (actListObj instanceof Collection<?>) {
			for (Object item : (Collection<?>) actListObj) {
				if (item instanceof Map<?, ?>) {
					Map<String, Object> group = (Map<String, Object>) item;
					String type = (String) group.get("type");
					if (type != null && isTrumpType(type)) {
						Map<String, Object> rel = relations.computeIfAbsent(type, k -> {
							Map<String, Object> m = new LinkedHashMap<>();
							m.put("acts", new ArrayList<Map<String, Object>>());
							m.put("chars", new ArrayList<Map<String, Object>>());
							return m;
						});
						Object acts = group.get("acts");
						if (acts instanceof Collection<?>) {
							((List<Map<String, Object>>) rel.get("acts"))
									.addAll((Collection<Map<String, Object>>) acts);
						}
					}
				}
			}
		}

		// charList から切札関連キャラクターを収集
		Object charListObj = ret.get("charList");
		if (charListObj instanceof Collection<?>) {
			for (Object item : (Collection<?>) charListObj) {
				if (item instanceof Map<?, ?>) {
					Map<String, Object> group = (Map<String, Object>) item;
					String type = (String) group.get("type");
					if (type != null && isTrumpType(type)) {
						Map<String, Object> rel = relations.computeIfAbsent(type, k -> {
							Map<String, Object> m = new LinkedHashMap<>();
							m.put("acts", new ArrayList<Map<String, Object>>());
							m.put("chars", new ArrayList<Map<String, Object>>());
							return m;
						});
						Object chars = group.get("chars");
						if (chars instanceof Collection<?>) {
							((List<Map<String, Object>>) rel.get("chars"))
									.addAll((Collection<Map<String, Object>>) chars);
						}
					}
				}
			}
		}

		ret.put("trumpRelations", relations);
	}

	private boolean isTrumpType(String type) {
		return type.startsWith("切札♠") || type.startsWith("切札♡") || type.startsWith("切札♢") || type.startsWith("切札♣");
	}

}
