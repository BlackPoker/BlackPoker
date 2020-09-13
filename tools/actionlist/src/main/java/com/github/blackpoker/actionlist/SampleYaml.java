package com.github.blackpoker.actionlist;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Map;

import org.yaml.snakeyaml.Yaml;

public class SampleYaml {

    public static void main(String[] args) throws IOException {

        Path input = Paths.get("original/v5-act.yaml");
        try (InputStream in = Files.newInputStream(input)) {
            Yaml yaml = new Yaml();
            Map<String,Object> map = (Map<String,Object>)yaml.load(in);
            System.out.println(map);
        }
    }

}
