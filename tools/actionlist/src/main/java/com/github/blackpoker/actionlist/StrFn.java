package com.github.blackpoker.actionlist;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;
import java.util.Properties;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class StrFn {

	private static final Pattern LIST_PTN = Pattern.compile("^(-*)(・|[１-９]．|[1-9]\\.|[A-Z]\\.).*$");

	private enum UlOl {
		/** ・ */
		Ul("<ul>", "</ul>", 1),
		/** 1. 2. 3. */
		Ol("<ol>", "</ol>", 2),
		/** A. B. C. */
		OlA("<ol type=\"A\">", "</ol>", 2);

		private String stTag;
		private String edTag;
		private int length;

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
			throw new IllegalArgumentException(str);
		}
	}

	public String cnvHtml(String str) {

		if (str == null || "".equals(str)) {
			return "";
		}

		String ret = str;

		// スート
		ret = ret.replaceAll("♡", "<span class=\"heart\"></span>");
		ret = ret.replaceAll("♥", "<span class=\"heart\"></span>");
		ret = ret.replaceAll("♠", "<span class=\"spade\"></span>");
		ret = ret.replaceAll("♢", "<span class=\"diam\"></span>");
		ret = ret.replaceAll("♦", "<span class=\"diam\"></span>");
		ret = ret.replaceAll("♣", "<span class=\"club\"></span>");

		// 改行
		ret = ret.replaceAll("\r\n", "<br>");
		ret = ret.replaceAll("\n", "<br>");
		ret = ret.replaceAll("\r", "<br>");

		// 罫線を置き換え
		ret = ret.replaceAll("---", "<hr>");

		// 箇条書き
		ret = cnvLi(ret);

		// 置換
		ret = replaceProp(ret);

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

		sb.append(ulol.stTag);
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
			sb.append("<li>").append(str.substring(indent + stack.peek().length)).append("</li>");
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

		Properties properties = PropertyHolder.ReplaceConf.getProperties();

		for (Object obj : properties.keySet()) {
			String key = (String) obj;
			String val = properties.getProperty(key);

			ret = ret.replaceAll(key, val);
		}

		return ret;
	}

	/**
	 * 「lite/std/pro/mast」を日本語に置き換える
	 */
	public String formatDataFormat(String raw) {
		if (raw == null) {
			return null;
		}
		return raw
				.replace("lite", "ライト")
				.replace("std", "スタンダード")
				.replace("pro", "プロ")
				.replace("mast", "マスター");
	}

	/**
	 * 「改行をカンマにして余分な・を取り除く」
	 */
	public String formatDataFrame(String raw) {
		if (raw == null) {
			return null;
		}
		return raw.replace("・", "")
				.replace("\n", ",")
				.trim();
	}

	public static void main(String[] args) {

		String input = ""
				+ "この能力が有効である時にダメージ判定アクションが効果を発揮した場合、ダメージ判定アクションの「1.兵士（アタッカー）と兵士（ブロッカー）の場合」を以下のように変更する。\n"
				+ "１．兵士（アタッカー）と兵士（ブロッカー）の場合、アタッカーとブロッカーで数字を比較し、大きい方を墓地に移動する。同じ場合は両方を墓地に移動する。アタッカーとブロッカーを比較した数字の差をダメージとして兵士を墓地に移した方のプレイヤーに与える。１アタッカーに対して複数ブロッカーいる場合、ブロッカーの合計数字と比較する。\n"
				+ "自分の兵士は以下の能力を得る。\n" +
				"・アタッカーかつダメージ判定アクションにてブロックされなかった場合、歓喜アクションを起こす。\n"
				+ "";

		String cnvHtml = (new StrFn()).cnvHtml(input);

		System.out.println(cnvHtml);

		// UlOl.check(input);

		Pattern ptn = Pattern.compile("( *)(・|[１-９]．|[1-9].).*");
		Matcher matcher = ptn.matcher(input);

		if (matcher.find()) {
			for (int i = 0; i <= matcher.groupCount(); i++) {
				System.out.println(matcher.group(i));
				System.out.println("---");
			}
		}
	}

}
