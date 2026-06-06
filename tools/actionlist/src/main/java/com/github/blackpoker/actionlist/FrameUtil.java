package com.github.blackpoker.actionlist;

import java.util.List;
import java.util.Map;

public class FrameUtil {

	/**
	 * 指定されたアクションが、指定されたフレームで利用可能かどうかを判定する（継承関係を加味する）。
	 *
	 * @param row アクションオブジェクト（Map）
	 * @param fr 判定対象のフレームオブジェクト（Map）
	 * @param frames すべてのフレームのリスト
	 * @return 利用可能な場合は true
	 */
	public static boolean isAvailable(Map<String, Object> row, Map<String, Object> fr, List<Map<String, Object>> frames) {
		if (row == null || fr == null) {
			return false;
		}
		Object frameObj = row.get("frame");
		if (frameObj == null) {
			// frame の指定がないアクションは、すべてのフレームで利用可能とみなす
			return true;
		}
		String frameStr = frameObj.toString();
		return checkFrameInheritance(frameStr, fr, frames);
	}

	/**
	 * 指定されたアクションが、指定されたフレーム名で利用可能かどうかを判定する（継承関係を加味する）。
	 *
	 * @param row アクションオブジェクト（Map）
	 * @param frameName 判定対象のフレーム名（String）
	 * @param frames すべてのフレームのリスト
	 * @return 利用可能な場合は true
	 */
	public static boolean isAvailable(Map<String, Object> row, String frameName, List<Map<String, Object>> frames) {
		if (row == null || frameName == null) {
			return false;
		}
		Object frameObj = row.get("frame");
		if (frameObj == null) {
			return true;
		}
		String frameStr = frameObj.toString();
		Map<String, Object> fr = findFrameByName(frameName, frames);
		if (fr != null) {
			return checkFrameInheritance(frameStr, fr, frames);
		}
		// frame.yaml に定義されていない名前の場合、直接の contains 判定でフォールバック
		return frameStr.contains(frameName);
	}

	private static boolean checkFrameInheritance(String frameStr, Map<String, Object> fr, List<Map<String, Object>> frames) {
		String frName = (String) fr.get("name");
		if (frName == null) {
			return false;
		}

		// 1. 直接名前に含まれているか判定
		if (frameStr.contains(frName)) {
			return true;
		}

		// 2. 親フレームからの継承関係を辿る
		Object inheritsObj = fr.get("inherits");
		if (inheritsObj != null) {
			String parentName = inheritsObj.toString();
			Map<String, Object> parentFrame = findFrameByName(parentName, frames);
			if (parentFrame != null) {
				return checkFrameInheritance(frameStr, parentFrame, frames);
			}
		}

		return false;
	}

	private static Map<String, Object> findFrameByName(String name, List<Map<String, Object>> frames) {
		if (frames == null) {
			return null;
		}
		for (Map<String, Object> fr : frames) {
			if (name.equals(fr.get("name"))) {
				return fr;
			}
		}
		return null;
	}
}
