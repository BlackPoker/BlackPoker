package com.github.blackpoker.actionlist;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;
import java.util.Properties;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class TexFn {

	private static final Pattern LIST_PTN = Pattern.compile("^(-*)(・|[１-９]．|[1-9]\\.|[A-Z]\\.|[※]).*$");

	private enum UlOl {
		/** ・ */
		Ul("\r\n" + "\\vspace{-1zh}%余白削除\r\n" + "\\begin{itemize}\r\n" + "\\setlength{\\leftskip}{-0.3cm}\r\n" + "\\setlength{\\parskip}{0pt} %4. 段落間余白．\r\n" + "", "\\vspace{-1zh}%余白削除\r\n\\end{itemize}", 1),
		/** 1. 2. 3. */
		Ol("\r\n" + "\\vspace{-1zh}%余白削除\r\n" + "\\begin{enumerate}\r\n" + "\\setlength{\\leftskip}{-0.3cm}\r\n" + "\\setlength{\\parskip}{0pt} %4. 段落間余白．\r\n" + "", "\\vspace{-1zh}%余白削除\r\n\\end{enumerate}", 2),
		/** A. B. C. */

		OlA("\r\n" + "" + "\\begin{enumerate}\r\n" + "\\renewcommand{\\labelenumi}{\\Alph{enumi}}\r\n" + "\\setlength{\\leftskip}{-0.3cm}\r\n" + "\\setlength{\\parskip}{0pt} %4. 段落間余白．\r\n" + "", "\r\n\\end{enumerate}", 2), AST("\r\n" + "\\vspace{-1zh}%余白削除\r\n" + "\\begin{enumerate}\r\n" + "\\renewcommand{\\labelenumi}{※}\r\n" + "\\setlength{\\leftskip}{-0.3cm}\r\n" + "\\setlength{\\itemsep}{0pt} %2. ブロック間の余白\r\n" + "\\setlength{\\parskip}{0pt} %4. 段落間余白．\r\n" + "", "\r\n\\vspace{-3mm}%余白削除\r\n\\end{enumerate}", 1);

		private String stTag;
		private String edTag;
		private int length; // 箇条書きキャラクタの文字数。「・」なら１、「１．」なら２

		private UlOl(String stTag, String edTag, int length) {
			this.stTag = stTag;
			this.edTag = edTag;
			this.length = length;
		}

		static UlOl check(String str) {
			if (Pattern.matches("^-*・.*$", str)) {
				return Ul;
			}
			if (Pattern.matches("^-*([A-Z]\\.).*$", str)) {
				return OlA;
			}
			if (Pattern.matches("^-*([１-９]．|[1-9]\\.).*$", str)) {
				return Ol;
			}
			if (Pattern.matches("^-*([※]).*$", str)) {
				return AST;
			}
			throw new IllegalArgumentException(str);
		}
	}

	public String cnv(String str) {

		if (str == null || "".equals(str)) {
			return "";
		}

		String ret = str;

		// スート
		ret = ret.replaceAll("♡", "{\\\\normalsize \\$\\\\heartsuit\\$} ");
		ret = ret.replaceAll("♥", "{\\\\normalsize \\$\\\\heartsuit\\$} ");
		ret = ret.replaceAll("♠", "{\\\\normalsize \\$\\\\spadesuit\\$} ");
		ret = ret.replaceAll("♢", "{\\\\normalsize \\$\\\\diamondsuit\\$} ");
		ret = ret.replaceAll("♦", "{\\\\normalsize \\$\\\\diamondsuit\\$} ");
		ret = ret.replaceAll("♣", "{\\\\normalsize \\$\\\\clubsuit\\$} ");

		// 改行
		ret = ret.replaceAll("\r\n", "<br>");
		ret = ret.replaceAll("\n", "<br>");
		ret = ret.replaceAll("\r", "<br>");

		// 罫線を置き換え
		ret = ret.replaceAll("---","<br>"
				+"\\\\vspace{1mm}%余白削除<br>"+
"\\\\hrule height 0.1mm depth 0mm width 66.5mm %罫線<br>"+
"\\\\vspace{1mm}%余白削除<br>"
				);

		// 箇条書き
		ret = cnvLi(ret);

		// 置換
		ret = replaceProp(ret);

		// <br>改行を元に戻す
		ret = ret.replaceAll("<br>", "\r\n\r\n");

		// 全角数字
		ret = ret.replaceAll("０", "0");
		ret = ret.replaceAll("１", "1");
		ret = ret.replaceAll("２", "2");
		ret = ret.replaceAll("３", "3");
		ret = ret.replaceAll("４", "4");
		ret = ret.replaceAll("５", "5");
		ret = ret.replaceAll("６", "6");
		ret = ret.replaceAll("７", "7");
		ret = ret.replaceAll("８", "8");
		ret = ret.replaceAll("９", "9");

		return ret;
	}

	// 箇条書き置換
	private String cnvLi(String str) {
		String ret = str;
		String[] strings = ret.split("<br>");

		List<String> list = new ArrayList<>();

		// boolean stFlg = false;
		StringBuilder sb = new StringBuilder();

		// Pattern ptn = Pattern.compile("^([ ]*)(・|[１-９]．|[1-9].|[A-Z].).*$");

		for (int i = 0; i < strings.length; i++) {
			String el = strings[i];

			if (LIST_PTN.matcher(el).find()) {
				list.add(el);
				continue;
			}

			if (!list.isEmpty()) {
				sb.append(cnvUlOl(list));
				list = new ArrayList<>();
			}

			sb.append(strings[i]);
			if (i != strings.length - 1) {
				sb.append("<br>");
			}
		}
		if (!list.isEmpty()) {
			sb.append(cnvUlOl(list));
			list = new ArrayList<>();
		}

		ret = sb.toString();
		return ret;
	}

	private String cnvUlOl(List<String> list) {

		StringBuilder sb = new StringBuilder();
		UlOl ulol = UlOl.check(list.get(0));
		int indent = 0;

		Deque<UlOl> stack = new ArrayDeque<UlOl>();
		stack.add(ulol);

		sb.append(stack.peek().stTag);
		for (String str : list) {
			Matcher matcher = LIST_PTN.matcher(str);
			if (matcher.find()) {
				// indent check
				int nowIndent = matcher.group(1).length();
				if (indent < nowIndent) {
					// インデントの階層が書くなった場合、新たにタグを開始する
					UlOl nextUlol = UlOl.check(str);
					stack.push(nextUlol);
					sb.append(stack.peek().stTag);
					indent = nowIndent;
				} else if (indent > nowIndent) {
					// インデントが減った場合、タグを閉じる
					sb.append(stack.pop().edTag);
					indent = nowIndent;
				}
			}

			sb.append("\r\n");
			// リストタグとして、要素を追加する。先頭に接頭文字がついているので削除する
			sb.append("\\item ").append(str.substring(indent + stack.peek().length)).append("\r\n");
		}

		// 終了タグを追加
		while (!stack.isEmpty()) {
			sb.append(stack.pop().edTag);
		}
		return sb.toString();
	}

	public String costHtml(String str) {
		String ret = str;
		ret = ret.replace("B", "<span class=\"cost-B\"></span>\n");
		ret = ret.replace("D", "<span class=\"cost-D\"></span>\n");
		ret = ret.replace("L", "<span class=\"cost-L\"></span>\n");
		ret = ret.replace("S", "<span class=\"cost-S\"></span>\n");
		ret = ret.replace("C", "<span class=\"cost-C\"></span>\n");
		return ret;
	}

	public String replaceProp(String str) {

		String ret = str;

		Properties properties = PropertyHolder.ReplaceTexConf.getProperties();

		for (Object obj : properties.keySet()) {
			String key = (String) obj;
			String val = properties.getProperty(key);

			ret = ret.replaceAll(key, val);
		}

		return ret;
	}

	public static String cnvAlphabetSuit(String str) {

		// スート
		switch (str) {
		case "h":
			return "{\\normalsize $\\heartsuit$}";
		case "s":
			return "{\\normalsize $\\spadesuit$}";
		case "d":
			return "{\\normalsize $\\diamondsuit$}";
		case "c":
			return "{\\normalsize $\\clubsuit$}";
		default:
			break;
		}

		return str;
	}

	public static String cnvSimpleAlphabetSuit(String str) {

		// スート
		switch (str) {
		case "h":
			return "$\\heartsuit$";
		case "s":
			return "$\\spadesuit$";
		case "d":
			return "$\\diamondsuit$";
		case "c":
			return "$\\clubsuit$";
		default:
			break;
		}

		return str;
	}

	public static void main(String[] args) {

		String input = "アタッカーとブロッカーを比較する\r\n"
				+ "１．兵士（アタッカー）と兵士（ブロッカー）の場合、アタッカーとブロッカーで数字を比較し、少ない方を墓地に移動する。同じ場合は両方を墓地に移動する。１アタッカーに対して複数ブロッカーいる場合、ブロッカーの合計数字と比較する。\r\n"
				+ "２．兵士（アタッカー）と防壁（ブロッカー）の場合、キャラクターリストの防壁-（能力）[ダメージ判定] 参照\r\n"
				+ "３．ブロックされなかったアタッカーの数字だけ対戦相手にダメージを与える。\r\n";

		TexFn fn = new TexFn();
		String ret = fn.cnv(input);

		System.out.println(ret);

	}

}
