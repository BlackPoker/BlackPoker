package com.github.blackpoker.actionlist;

import java.awt.Point;
import java.io.IOException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.jopendocument.dom.spreadsheet.MutableCell;
import org.jopendocument.dom.spreadsheet.Sheet;
import org.jopendocument.dom.spreadsheet.SpreadSheet;

import com.fasterxml.jackson.databind.ObjectMapper;

public class SheetUtil {

	static final Pattern minCellPattern = Pattern.compile("\\$?([A-Z]+)\\$?([0-9]+)");

	private SheetUtil() {
	}

	public static String getVal(Sheet sheet, int colIdx, int rowIdx) {
		String val;
		try {
			MutableCell<SpreadSheet> cell = sheet.getCellAt(colIdx, rowIdx);
			val = cell.getTextValue();
			System.out.println("getVal:" + colIdx + ":" + rowIdx + " " + val);
		} catch (Exception e) {
			return null;
		}
		return val;
	}

	public static String getVal(Sheet sheet, String addr) {
		MutableCell<SpreadSheet> cell = sheet.getCellAt(addr);
		String val = cell.getTextValue();
		return val;
	}

	public static List<Map<String, String>> getListMap(Sheet sheet, int stColIdx, int stRowIdx, int reqColIdx) {

		int colIdx = stColIdx;
		int rowIdx = stRowIdx;

		// ヘッダ行を取得
		List<String> heads = new ArrayList<>();
		{
			String val = null;
			while (true) {
				val = getVal(sheet, colIdx, rowIdx);
				if (val == null || "".equals(val)) {
					break;
				}
				colIdx++;
				heads.add(val);
			}
		}

		// 本文読み込み
		List<Map<String, String>> ret = new ArrayList<>();
		{
			rowIdx++;
			colIdx = stColIdx;
			String val = null;
			while (true) {
				// 必須列の値確認
				val = getVal(sheet, reqColIdx, rowIdx);
				if (val == null || "".equals(val)) {
					break;
				}

				Map<String, String> row = new LinkedHashMap<>();
				for (int i = 0; i < heads.size(); i++) {
					val = getVal(sheet, colIdx + i, rowIdx);
					String key = heads.get(i);
					row.put(key, val);
				}
				ret.add(row);
				rowIdx++;
			}
		}
		return ret;
	}

	public static Map<String, String> loadConfig(Sheet sheet) {

		// シートのA1セルを設定値として取得する
		String json = getVal(sheet, 0, 0);

		// Jsonをマプオブジェクトに変換
		ObjectMapper mapper = new ObjectMapper();
		try {
			Map<String, String> map = mapper.readValue(json, Map.class);
			return map;
		} catch (IOException e) {
			throw new IllegalArgumentException(e);
		}
	}

	public static Point getPoint(String ref) {
		Matcher localMatcher = minCellPattern.matcher(ref);
		if (!localMatcher.matches()) {
			return null;
		}
		// localMatcher.group(1), localMatcher.group(2)
		return resolve(localMatcher.group(1), localMatcher.group(2));
	}

	private static final int toInt(String paramString) {
		if (paramString.length() < 1) {
			throw new IllegalArgumentException("x cannot be empty");
		}
		paramString = paramString.toUpperCase();
		int i = 0;
		for (int j = 0; j < paramString.length(); j++) {
			i = i * 26 + (paramString.charAt(j) - 'A' + 1);
		}
		return i - 1;
	}

	private static final Point resolve(String paramString1, String paramString2) {
		return new Point(toInt(paramString1), Integer.parseInt(paramString2) - 1);
	}
}
