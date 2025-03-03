package com.github.blackpoker.actionlist;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class CsvFn {

	private static final Pattern LIST_PTN = Pattern.compile("^(-*)(・|[１-９]．|[1-9]\\.|[A-Z]\\.|[※]).*$");

	private enum UlOl {
		/** ・ */
		Ul("", "", 1),
		/** 1. 2. 3. */
		Ol("", "", 2),
		/** A. B. C. */
		OlA("", "",  2), 
		
		AST("", "",  1);

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

		// 改行
		ret = ret.replaceAll("\r\n", "<br>");
		ret = ret.replaceAll("\n", "<br>");
		ret = ret.replaceAll("\r", "<br>");
		
		// 箇条書き
		ret = cnvLi(ret);

		// 置換
		// ret = replaceProp(ret);

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
			// sb.append("").append(str.substring(indent + stack.peek().length)).append("\r\n");
			String s =  replaceLeadingHyphens(str);
			sb.append("").append(s).append("\r\n");
		}

		// 終了タグを追加
		while (!stack.isEmpty()) {
			sb.append(stack.pop().edTag);
		}
		return sb.toString();
	}

	public static String replaceLeadingHyphens(String str) {
        Pattern pattern = Pattern.compile("^(-+)"); // 先頭の `-` をキャプチャ
        Matcher matcher = pattern.matcher(str);
        
        if (matcher.find()) {
            int hyphenCount = matcher.group(1).length(); // `-` の個数を取得
			// vmフォーマット側の都合で3としている
            String spaces = " ".repeat(hyphenCount * 3); // `-` の個数 × 3 のスペースを生成
            return spaces + str.substring(hyphenCount); // `-` をスペースに置換
        }
        
        return str; // `-` がなければそのまま返す
    }
}
